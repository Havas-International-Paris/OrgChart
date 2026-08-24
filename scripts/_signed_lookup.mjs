import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ids = JSON.parse(readFileSync('/tmp/dms_ids.json', 'utf8'));
const OUT = 'local-data/linkedin-photos/photo-candidates';
import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });

function bingImages(query) {
  const xml = `${OUT}/_bing_${Math.random().toString(36).slice(2)}.html`;
  const q = `"${query}" linkedin`;
  const quotedQ = JSON.stringify(q);
  const script = [
    'UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"',
    'CK=$(mktemp)',
    'curl -s --max-time 20 -A "$UA" -c "$CK" "https://www.bing.com/" -o /dev/null',
    'sleep 1',
    `Q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" ${quotedQ})`,
    `curl -s --max-time 20 -A "$UA" -b "$CK" -c "$CK" "https://www.bing.com/images/search?q=$Q&form=HDRSC2&count=50" -o "${xml}"`,
    'rm -f "$CK"',
  ].join('\n');
  try {
    execSync(script, { shell: '/bin/bash' });
  } catch (e) {
    return [];
  }
  let html = '';
  try { html = readFileSync(xml, 'utf8'); } catch { return []; }
  try { execSync(`rm -f "${xml}"`); } catch {}
  const items = [];
  const re = /\bm="([^"]+)"/g;
  let mm;
  while ((mm = re.exec(html))) {
    let raw = mm[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('\\u0026', '&');
    let d;
    try { d = JSON.parse(raw); } catch { continue; }
    if (!d || typeof d !== 'object') continue;
    const mu = d.murl || '';
    const pu = (d.purl || d.pageurl || '').replace(/\\/g, '');
    if (mu.includes('profile-displayphoto') || mu.includes('profile-framedphoto')) {
      items.push({ murl: mu, purl: pu });
    }
  }
  return items;
}

const results = [];
for (const [name, dmsId] of Object.entries(ids)) {
  if (!dmsId) continue;
  const items = bingImages(name);
  let signed = null;
  let match = null;
  for (const it of items) {
    if (it.murl.includes(dmsId)) { match = { ...it, type: 'id' }; break; }
    if (!signed && /\?e=\d+&v=beta&t=/.test(it.murl)) signed = it.murl;
  }
  results.push({ name, dmsId, id_match: !!match, murl: match ? match.murl : (signed || ''), type: match ? match.type : 'any-signed' });
  await new Promise((r) => setTimeout(r, 2200));
}

writeFileSync(`${OUT}/signed-lookup.json`, JSON.stringify(results, null, 2));
const got = results.filter(r => r.murl.includes(r.dmsId));
console.log('id-matched:', got.length, '/', results.length);
for (const r of results) console.log(`${r.id_match ? 'MATCH' : 'no'} ${r.name} ${r.murl.slice(0, 90)}`);