// Step 1 of the photo import: find candidate LinkedIn profile slugs by name.
//
// Deliberately uses Bing (not LinkedIn) so slug discovery costs the user's
// LinkedIn account nothing. Precision does not matter much here — recall does.
// Every candidate is confirmed afterwards by actually reading the profile
// (name + headline + employer) in _linkedin_confirm.mjs's browser step, which
// is the only authoritative check. Bing alone cannot tell homonyms apart: a
// sample run matched a supermarket cashier and an unrelated agency director to
// two of our employees' names.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const IN = 'local-data/linkedin-photos/employees-without-photo-2026-08-29.json';
const OUT = 'local-data/linkedin-photos/slug-candidates.json';
const TMP = (process.env.CLAUDE_JOB_DIR || '/tmp') + '/tmp';
mkdirSync(TMP, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bing's *web* search returns a 128KB page with no LinkedIn links at all
// (anti-bot), and so does DuckDuckGo's html endpoint. Bing *Images* is the one
// channel that still answers, and its per-result `m="..."` JSON carries both
// the image (`murl`) and the page it was found on (`purl`) — which for a
// profile photo is the LinkedIn profile itself. That `purl` is the slug source.
//
// One fresh cookie jar per query: a shared jar demonstrably pollutes Bing's
// results (documented in the LinkedIn-photo-import memory).
function bingImages(query) {
  const out = `${TMP}/_s_${Math.random().toString(36).slice(2)}.html`;
  const script = [
    `UA=${JSON.stringify(UA)}`,
    'CK=$(mktemp)',
    'curl -s --max-time 25 -A "$UA" -c "$CK" "https://www.bing.com/" -o /dev/null',
    `Q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" ${JSON.stringify(query)})`,
    `curl -s --max-time 25 -A "$UA" -b "$CK" -c "$CK" "https://www.bing.com/images/search?q=$Q&form=HDRSC2&count=50" -o "${out}"`,
    'rm -f "$CK"',
  ].join('\n');
  try { execSync(script, { shell: '/bin/bash' }); } catch { return []; }
  let html = '';
  try { html = readFileSync(out, 'utf8'); } catch { return []; }
  try { execSync(`rm -f "${out}"`); } catch {}

  const items = [];
  for (const m of html.matchAll(/\bm="([^"]+)"/g)) {
    const raw = m[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('\\u0026', '&');
    let d;
    try { d = JSON.parse(raw); } catch { continue; }
    if (!d) continue;
    const purl = String(d.purl || d.pageurl || '').replace(/\\/g, '');
    const s = purl.match(/linkedin\.com\/in\/([^/?#"' ]+)/i);
    if (s) items.push({ slug: decodeURIComponent(s[1]).replace(/\/$/, '').toLowerCase(), title: String(d.t || '').slice(0, 110) });
  }
  return items;
}

const emps = JSON.parse(readFileSync(IN, 'utf8'));
const prior = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
const done = new Set(prior.map((p) => p.id));
const results = [...prior];

let n = 0;
for (const e of emps) {
  if (done.has(e.id)) continue;
  const full = `${e.first_name} ${e.last_name}`;
  const seen = new Map();
  for (const it of [...bingImages(`"${full}" linkedin`), ...bingImages(`"${full}" Havas linkedin`)]) {
    if (!seen.has(it.slug)) seen.set(it.slug, it.title);
  }
  const slugs = [...seen].map(([slug, title]) => ({ slug, title }));
  results.push({ ...e, slugs });
  n++;
  console.log(`${String(n).padStart(3)} ${full.padEnd(32)} ${slugs.length} slug(s)  ${slugs.slice(0, 2).map((s) => s.slug).join(', ')}`);
  writeFileSync(OUT, JSON.stringify(results, null, 2));
  await sleep(1200 + Math.random() * 1500);
}
console.log(`\ndone: ${results.length} employees, ${results.filter((r) => r.slugs.length).length} with >=1 candidate`);
