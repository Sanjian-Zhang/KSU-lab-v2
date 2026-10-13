# KSU-lab-v2

Intelligent Biomechanics Lab Website

## Publications

The Publications page is generated from `src/data/publications.json`, which is rebuilt automatically every time the site is built (`npm run build`). The list comes from Dr. Shi's ORCID profile and Semantic Scholar, with author lists filled in from Crossref.

- To refresh the list without building: `npm run fetch:pubs`
- To add a paper that isn't on ORCID or Semantic Scholar, or fix a wrong title/author list: add it to `src/data/publications-manual.json`
- To hide a paper (for example one matched to a different Lei Shi): add its DOI or title to `src/data/publications-exclude.json`

If ORCID or Semantic Scholar is down during a build, the previous list is kept and the build continues.

## Research videos

Each research area on the Research page has a video slot. Put the video in `public/assets/videos/` (or use a YouTube/Vimeo link) and set its `src` in the `videos` list at the top of `src/pages/research.astro`. Slots without a video show a "coming soon" placeholder.
