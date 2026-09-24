#!/usr/bin/env node
/**
 * Fetch publications from Semantic Scholar API for Lei Shi (author ID: 2261363388)
 * MERGE with existing manual entries so nothing is lost.
 *
 * Usage: node scripts/fetch-publications.js
 *        npm run fetch:pubs
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUTHOR_ID = '2261363388'; // Lei Shi, Kennesaw State University - Biomechanics
const FIELDS = 'title,authors,year,venue,openAccessPdf,url,externalIds';
const API_URL = `https://api.semanticscholar.org/graph/v1/author/${AUTHOR_ID}/papers?fields=${FIELDS}&limit=100`;

const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/data/publications.json'
);

const LAB_MEMBERS = ['Lei Shi', 'Nanlong Sun', 'Nan Sun', 'Yue Li', 'Sanjian Zhang'];

function getPaperLink(paper) {
  if (paper.openAccessPdf?.url) return paper.openAccessPdf.url;
  if (paper.externalIds?.DOI) return `https://doi.org/${paper.externalIds.DOI}`;
  if (paper.externalIds?.ArXiv) return `https://arxiv.org/abs/${paper.externalIds.ArXiv}`;
  if (paper.url) return paper.url;
  return null;
}

// Normalize title for dedup (lowercase, remove punctuation, collapse spaces)
function norm(t) {
  return (t || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

async function fetchPublications() {
  // 1. Load existing data if present
  let existing = { papers: [] };
  if (existsSync(OUTPUT_PATH)) {
    try {
      existing = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
      console.log(`Loaded ${existing.papers.length} existing papers from publications.json`);
    } catch {
      console.log('No valid existing data, starting fresh');
    }
  }

  // 2. Fetch from Semantic Scholar
  console.log('\nFetching from Semantic Scholar...');
  const response = await fetch(API_URL, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Semantic Scholar API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const rawPapers = data.data || [];

  // 3. Clean API data
  const apiPapers = rawPapers
    .filter(p => p.year && p.title && p.title.length > 20)
    .map(p => ({
      title: p.title.trim(),
      authors: (p.authors || []).map(a => a.name),
      venue: (p.venue || '').trim(),
      year: p.year,
      doi: p.externalIds?.DOI || null,
      link: getPaperLink(p),
    }));

  console.log(`  Semantic Scholar returned ${apiPapers.length} valid papers (filtered ${rawPapers.length - apiPapers.length} garbage)`);

  // 4. Merge: keep existing papers that aren't in API results (by title match)
  const apiTitles = new Set(apiPapers.map(p => norm(p.title)));
  const manualPapers = (existing.papers || []).filter(p => !apiTitles.has(norm(p.title)));

  if (manualPapers.length > 0) {
    console.log(`  Keeping ${manualPapers.length} manual entries not found on Semantic Scholar:`);
    for (const m of manualPapers) {
      console.log(`    - ${m.title.slice(0, 70)} (${m.year})`);
    }
  }

  // 5. Combine, deduplicate, sort
  const allPapers = [...apiPapers, ...manualPapers];
  const seen = new Set();
  const uniquePapers = allPapers.filter(p => {
    const key = norm(p.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.year - a.year);

  // 6. Write output
  const result = {
    fetchedAt: new Date().toISOString(),
    totalPapers: uniquePapers.length,
    labMembers: LAB_MEMBERS,
    papers: uniquePapers,
  };

  const outDir = dirname(OUTPUT_PATH);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`\n✓ Written to ${OUTPUT_PATH}`);
  for (const year of [...new Set(uniquePapers.map(p => p.year))].sort((a, b) => b - a)) {
    const count = uniquePapers.filter(p => p.year === year).length;
    console.log(`  ${year}: ${count} papers`);
  }
}

fetchPublications().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
