import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const cands = JSON.parse(readFileSync('local-data/linkedin-photos/photo-candidates/candidates.json', 'utf8'));
const DIR = 'local-data/linkedin-photos/photos';
mkdirSync(DIR, { recursive: true });

function fixMurl(u) {
  return u.replace(/(profile-displayphoto-shrink_\d{3}_\d{3})\/\1/gi, '$1');
}

const have = cands.filter((c) => c.murl);
const results = [];
for (const c of have) {
  const fname = `${c.first_name} ${c.last_name}.jpg`;
  const path = `${DIR}/${fname}`;
  if (existsSync(path) && readFileSync(path).length > 5000) {
    results.push({ ...c, file: fname, ok: true });
    continue;
  }
  const murl = fixMurl(c.murl);
  try {
    execFileSync('curl', ['-s', '--max-time', '30', '-L', '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', '-o', path, murl]);
    sizes = readFileSync(path).length;
    if (sizes > 5000) {
      results.push({ ...c, file: fname, ok: true });
    } else {
      execFileSync('rm', ['-f', path]);
      results.push({ ...c, file: null, ok: false });
    }
  } catch {
    results.push({ ...c, file: null, ok: false });
  }
}

writeFileSync(`${DIR}/download-results.json`, JSON.stringify(results, null, 2));
const ok = results.filter((r) => r.ok);
console.log('downloaded', ok.length, '/', have.length);
console.log('by type:', JSON.stringify({ exact: ok.filter(r=>r.match_type==='exact').length, title: ok.filter(r=>r.match_type==='title').length }));
for (const r of results.filter(x=>!x.ok)) console.log('FAIL', r.first_name, r.last_name);