// Step 2: rank each employee's candidate slugs so the browser step only has to
// open one or two profiles per person instead of the ~17 Bing returns.
//
// Ranking is heuristic and deliberately NOT trusted on its own — the browser
// step still confirms every pick by reading the live profile. Its only job is
// to put the likely profile first so we spend as few LinkedIn requests as
// possible (each one is paced 10-30s at the user's request).
import { readFileSync, writeFileSync } from 'node:fs';

const IN = 'local-data/linkedin-photos/slug-candidates.json';
const OUT = 'local-data/linkedin-photos/slug-ranked.json';

const norm = (s) => (s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

const rows = JSON.parse(readFileSync(IN, 'utf8'));

for (const r of rows) {
  const first = norm(r.first_name);
  // Multi-token surnames ("Abitbol Terrier", "Lefebvre Bertoletti") are the
  // common case here, and LinkedIn slugs routinely keep only one token. Score
  // against every token, not just the whole surname, or those people score 0
  // against a slug that is in fact theirs.
  const lastTokens = (r.last_name || '').split(/[\s'-]+/).map(norm).filter((s) => s.length > 1);
  const last = norm(r.last_name);
  const full = first + last;

  for (const c of r.slugs) {
    const slugN = norm(c.slug);
    const titleN = norm(c.title);
    const tokenHits = lastTokens.filter((tok) => slugN.includes(tok)).length;
    let score = 0;
    // Slug is the strongest signal: LinkedIn builds it from the real name.
    if (slugN.startsWith(full)) score += 100;
    else if (slugN.startsWith(last + first)) score += 90;
    else if (slugN.includes(first) && tokenHits === lastTokens.length) score += 80;
    else if (slugN.includes(first) && tokenHits > 0) score += 65;
    else if (tokenHits > 0) score += 25;
    else if (slugN.includes(first)) score += 10;
    // Title usually reads "First Last - Headline | LinkedIn".
    if (titleN.includes(full)) score += 40;
    else if (titleN.includes(first) && lastTokens.some((tok) => titleN.includes(tok))) score += 30;
    else if (lastTokens.some((tok) => titleN.includes(tok))) score += 15;
    // Employer mentioned right in the title is a strong tiebreaker.
    if (/havas/.test(titleN)) score += 45;
    // Their job title / business unit showing up in the headline.
    if (r.job_title && titleN.includes(norm(r.job_title))) score += 20;
    c.score = score;
  }

  r.slugs.sort((a, b) => b.score - a.score);
  // Keep a shortlist: anything close to the best, capped at 3.
  const top = r.slugs[0] ? r.slugs[0].score : 0;
  r.shortlist = r.slugs.filter((c) => c.score >= Math.max(40, top - 45)).slice(0, 3);
}

writeFileSync(OUT, JSON.stringify(rows, null, 2));

const withList = rows.filter((r) => r.shortlist.length);
const strong = rows.filter((r) => r.shortlist[0] && r.shortlist[0].score >= 140);
console.log(`employees:            ${rows.length}`);
console.log(`with a shortlist:     ${withList.length}`);
console.log(`  strong top pick:    ${strong.length}  (score >= 140)`);
console.log(`no candidate at all:  ${rows.length - withList.length}`);
console.log(`total profiles to open: ${rows.reduce((n, r) => n + r.shortlist.length, 0)}`);
console.log('\nno-candidate list:');
for (const r of rows) if (!r.shortlist.length) console.log('  ', r.first_name, r.last_name, `(${r.slugs.length} raw)`);
