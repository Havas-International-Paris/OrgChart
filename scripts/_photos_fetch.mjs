import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const matches = JSON.parse(readFileSync('local-data/linkedin-photos/matches-consolidated.json', 'utf8'));
const confirmed = matches.filter((m) => m.status === 'confirmed' && m.linkedin_url);

const OUT = 'local-data/linkedin-photos/photo-candidates';
mkdirSync(OUT, { recursive: true });

function slug(url) {
  const idx = url.indexOf('/in/');
  if (idx < 0) return '';
  return (url.slice(idx + 4).split('?')[0].split('#')[0]).replace(/\/$/, '').toLowerCase();
}

function norm(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['']/g, '')
    .toLowerCase();
}

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
    if (mu.includes('profile-displayphoto')) {
      items.push({ murl: mu, purl: pu, title: d.t || '', desc: d.desc || '' });
    }
  }
  return items;
}

const results = [];
for (const m of confirmed) {
  const targetSlug = slug(m.linkedin_url);
  const query = `${m.first_name} ${m.last_name}`;
  const items = bingImages(query);
  // rank: exact slug in purl => perfect; else title matching full name
  const normName = norm(`${m.first_name} ${m.last_name}`);
  let chosen = null;
  let matchType = 'none';
  for (const it of items) {
    const puSlug = slug(it.purl);
    const titleNorm = norm(it.title);
    if (targetSlug && puSlug === targetSlug) { chosen = it; matchType = 'exact'; break; }
  }
  if (!chosen) {
    for (const it of items) {
      const titleNorm = norm(it.title);
      if (normName.includes(it.title) || titleNorm.includes(normName) || normName.includes(titleNorm)) {
        chosen = it; matchType = 'title'; break;
      }
    }
  }
  results.push({
    employee_id: m.employee_id, first_name: m.first_name, last_name: m.last_name,
    linkedin_url: m.linkedin_url, match_type: matchType, murl: chosen ? chosen.murl : '',
    purl: chosen ? chosen.purl : '', num_candidates: items.length,
  });
  // modest pacing to avoid Bing rate-limit
  await new Promise((r) => setTimeout(r, 2500));
}

writeFileSync(`${OUT}/candidates.json`, JSON.stringify(results, null, 2));
const byType = {};
for (const r of results) byType[r.match_type] = (byType[r.match_type] || 0) + 1;
console.log('processed', results.length, 'by type:', JSON.stringify(byType));
for (const r of results) console.log(`[${r.match_type}] ${r.first_name} ${r.last_name} cands=${r.num_candidates} ${r.murl ? r.murl.slice(0, 80) : ''}`);