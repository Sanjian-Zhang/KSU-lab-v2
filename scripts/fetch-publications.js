#!/usr/bin/env node
/**
 * Rebuild src/data/publications.json for Lei Shi from public sources:
 *   1. ORCID (main source, maintained by Dr. Shi)
 *   2. Semantic Scholar (catches preprints that aren't on ORCID yet)
 *   3. Crossref (fills in full author lists and venues by DOI)
 *
 * Hand-edited files:
 *   src/data/publications-manual.json   papers to always include (also overrides fetched data)
 *   src/data/publications-exclude.json  DOIs or titles to always hide
 *
 * Usage: npm run fetch:pubs
 *        node scripts/fetch-publications.js --soft   (used by prebuild; never fails the build)
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORCID_ID = '0000-0001-6341-2203'; // Lei Shi, Columbia University / Kennesaw State University
const SEMANTIC_SCHOLAR_ID = '2261363388';
const LAB_MEMBERS = ['Lei Shi', 'Nanlong Sun', 'Nan Sun', 'Yue Li', 'Sanjian Zhang'];

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data');
const OUTPUT_PATH = resolve(DATA_DIR, 'publications.json');
const MANUAL_PATH = resolve(DATA_DIR, 'publications-manual.json');
const EXCLUDE_PATH = resolve(DATA_DIR, 'publications-exclude.json');

const SOFT = process.argv.includes('--soft');
const USER_AGENT = 'KSU-Intelligent-Biomechanics-Lab-site (https://www.intelligentbiomechanicslab.net)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Normalize title for matching (lowercase, remove punctuation, collapse spaces)
function norm(t) {
  return (t || '').toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function cleanText(t) {
  return (t || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function keyOf(paper) {
  return paper.doi ? `doi:${paper.doi.toLowerCase()}` : `title:${norm(paper.title)}`;
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    console.warn(`  Could not read ${path}: ${err.message}`);
    return fallback;
  }
}

async function getJson(url, { headers = {}, tries = 4 } = {}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers },
        signal: controller.signal,
      });
      if (res.status === 404) return null;
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status}`);
      if (attempt === tries) throw new Error(`HTTP ${res.status} after ${tries} tries`);
    } catch (err) {
      if (attempt === tries) throw err;
    } finally {
      clearTimeout(timer);
    }
    await sleep(1500 * 2 ** (attempt - 1)); // rate limited or flaky: back off and retry
  }
}

async function fromOrcid() {
  const data = await getJson(`https://pub.orcid.org/v3.0/${ORCID_ID}/works`);
  return (data?.group || []).map((group) => {
    const work = group['work-summary'][0];
    const ids = group['external-ids']?.['external-id'] || [];
    const doi = ids.find((id) => id['external-id-type'] === 'doi')?.['external-id-value'] || null;
    return {
      title: cleanText(work.title?.title?.value),
      authors: [],
      venue: cleanText(work['journal-title']?.value),
      year: Number(work['publication-date']?.year?.value) || null,
      doi: doi ? doi.toLowerCase() : null,
      link: doi ? `https://doi.org/${doi}` : work.url?.value || null,
    };
  });
}

async function fromSemanticScholar() {
  const fields = 'title,authors,year,venue,openAccessPdf,url,externalIds';
  const headers = process.env.SEMANTIC_SCHOLAR_API_KEY ? { 'x-api-key': process.env.SEMANTIC_SCHOLAR_API_KEY } : {};
  const data = await getJson(
    `https://api.semanticscholar.org/graph/v1/author/${SEMANTIC_SCHOLAR_ID}/papers?fields=${fields}&limit=100`,
    { headers }
  );
  return (data?.data || []).map((p) => {
    const doi = p.externalIds?.DOI?.toLowerCase() || null;
    return {
      title: cleanText(p.title),
      authors: (p.authors || []).map((a) => a.name),
      venue: cleanText(p.venue),
      year: p.year || null,
      doi,
      link: doi ? `https://doi.org/${doi}` : p.openAccessPdf?.url || p.url || null,
    };
  });
}

// Crossref has the full author list and canonical venue for most DOIs
async function enrichFromCrossref(paper) {
  if (!paper.doi) return paper;
  try {
    const data = await getJson(`https://api.crossref.org/works/${encodeURIComponent(paper.doi)}`, { tries: 2 });
    const work = data?.message;
    if (!work) return paper;
    const authors = (work.author || [])
      .map((a) => [a.given, a.family].filter(Boolean).join(' ') || a.name)
      .filter(Boolean);
    const venue = cleanText(work['container-title']?.[0]) || cleanText(work.institution?.[0]?.name);
    const year = work.issued?.['date-parts']?.[0]?.[0];
    return {
      ...paper,
      title: paper.title || cleanText(work.title?.[0]),
      authors: authors.length ? authors : paper.authors,
      venue: paper.venue || venue,
      year: paper.year || year || null,
    };
  } catch {
    return paper;
  }
}

async function fetchPublications() {
  const previous = readJson(OUTPUT_PATH, { papers: [] });
  const manual = readJson(MANUAL_PATH, { papers: [] }).papers || [];
  const exclude = readJson(EXCLUDE_PATH, { dois: [], titles: [] });
  const excludedDois = new Set((exclude.dois || []).map((d) => d.toLowerCase()));
  const excludedTitles = new Set((exclude.titles || []).map(norm));
  const isExcluded = (p) => (p.doi && excludedDois.has(p.doi.toLowerCase())) || excludedTitles.has(norm(p.title));

  const sources = [
    ['ORCID', fromOrcid],
    ['Semantic Scholar', fromSemanticScholar],
  ];
  const fetched = [];
  let failures = 0;
  for (const [name, load] of sources) {
    try {
      const papers = (await load()).filter((p) => p.title && p.year);
      console.log(`  ${name}: ${papers.length} papers`);
      fetched.push(...papers);
    } catch (err) {
      failures++;
      console.warn(`  ${name} failed: ${err.message}`);
    }
  }

  if (failures === sources.length) {
    console.warn('\nAll sources failed. Keeping the existing publications.json.');
    if (!SOFT) process.exitCode = 1;
    return;
  }

  // Merge: earlier sources win, but later ones fill in missing fields
  const merged = new Map();
  const titleIndex = new Map();
  for (const paper of fetched) {
    const existingKey = merged.has(keyOf(paper)) ? keyOf(paper) : titleIndex.get(norm(paper.title));
    if (existingKey) {
      const current = merged.get(existingKey);
      merged.set(existingKey, {
        ...current,
        authors: current.authors.length ? current.authors : paper.authors,
        venue: current.venue || paper.venue,
        doi: current.doi || paper.doi,
        link: current.link || paper.link,
      });
    } else {
      merged.set(keyOf(paper), paper);
      titleIndex.set(norm(paper.title), keyOf(paper));
    }
  }

  console.log('\nLooking up author lists on Crossref...');
  for (const [key, paper] of merged) {
    if (paper.doi) {
      merged.set(key, await enrichFromCrossref(paper));
      await sleep(150);
    }
  }

  // If a source failed this run, keep what it gave us last time
  if (failures > 0) {
    for (const paper of previous.papers || []) {
      if (!merged.has(keyOf(paper)) && !titleIndex.has(norm(paper.title))) merged.set(keyOf(paper), paper);
    }
  }

  // Manual entries always win
  for (const paper of manual) {
    const existingKey = titleIndex.get(norm(paper.title));
    if (existingKey && existingKey !== keyOf(paper)) merged.delete(existingKey);
    merged.set(keyOf(paper), { authors: [], venue: '', doi: null, link: null, ...paper });
  }

  const papers = [...merged.values()]
    .filter((p) => !isExcluded(p))
    .sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));

  const before = new Set((previous.papers || []).map((p) => norm(p.title)));
  const after = new Set(papers.map((p) => norm(p.title)));
  const added = papers.filter((p) => !before.has(norm(p.title)));
  const removed = (previous.papers || []).filter((p) => !after.has(norm(p.title)));

  writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ fetchedAt: new Date().toISOString(), totalPapers: papers.length, labMembers: LAB_MEMBERS, papers }, null, 2) + '\n',
    'utf-8'
  );

  console.log(`\nWrote ${papers.length} papers to src/data/publications.json`);
  if (added.length) {
    console.log(`\nNew since last run (check these are Dr. Shi's; hide any that aren't in publications-exclude.json):`);
    for (const p of added) console.log(`  + ${p.year}  ${p.title.slice(0, 90)}${p.doi ? `  [${p.doi}]` : ''}`);
  }
  if (removed.length) {
    console.log('\nNo longer listed (add to publications-manual.json if they should stay):');
    for (const p of removed) console.log(`  - ${p.year}  ${p.title.slice(0, 90)}`);
  }
}

fetchPublications().catch((err) => {
  console.error('Publication update failed:', err.message);
  if (!SOFT) process.exitCode = 1;
});
