// Move the photos the browser saved into ~/Downloads over to the repo's
// local-data folder, recording each file's real pixel size.
//
// The browser is the only thing that can fetch a signed media.licdn.com URL
// (no CORS for anyone else, and the signature cannot be forged), so downloads
// land in ~/Downloads first and get collected here.
import { readdirSync, renameSync, existsSync, mkdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const SRC = `${homedir()}/Downloads`;
const DST = 'local-data/linkedin-photos/photos-hd';
mkdirSync(DST, { recursive: true });

const dims = (p) => {
  try {
    const o = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', p], { encoding: 'utf8' });
    const w = (o.match(/pixelWidth:\s*(\d+)/) || [])[1];
    const h = (o.match(/pixelHeight:\s*(\d+)/) || [])[1];
    return w && h ? `${w}x${h}` : '?';
  } catch { return '?'; }
};

// Only ever move files whose name matches an employee in the registry list.
// An earlier version took every .jpg in ~/Downloads and walked off with two of
// the user's own photos — never widen this filter.
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');
const employees = JSON.parse(readFileSync('local-data/linkedin-photos/employees-without-photo-2026-08-29.json', 'utf8'));
const known = new Set(employees.map((e) => norm(`${e.first_name} ${e.last_name}`)));

const moved = [];
for (const f of readdirSync(SRC)) {
  if (!/\.jpg$/i.test(f)) continue;
  if (/^ZZTEST|^ZZPROBE/.test(f)) continue;   // development probes, not employees
  // A Chrome "name (1).jpg" means the page fired TWO downloads under one name.
  // On Workday that second image is the *manager's* thumbnail, not the
  // employee's — and "(1)" sorts before the plain name, so an earlier version
  // of this script silently preferred the wrong face. Never map these back to
  // an employee; surface them instead.
  if (/\(\d+\)\.jpg$/i.test(f)) { console.log('DUPLICATE-SUFFIX file, NOT collected (likely wrong person):', f); continue; }
  const stem = f.replace(/\.jpg$/i, '').trim();
  if (!known.has(norm(stem))) { console.log('not an employee file, leaving alone:', f); continue; }
  const from = `${SRC}/${f}`;
  if (!statSync(from).isFile()) continue;
  const to = `${DST}/${f}`;
  if (existsSync(to)) { console.log('already collected, skipping:', f); continue; }
  renameSync(from, to);
  moved.push({ file: f, name: f.replace(/\.jpg$/i, ''), dims: dims(to), bytes: statSync(to).size });
}

for (const m of moved) console.log(`  ${m.dims.padStart(9)}  ${m.bytes.toString().padStart(7)}b  ${m.name}`);
console.log(`\nmoved ${moved.length}; total in ${DST}: ${readdirSync(DST).filter((f) => /\.jpg$/i.test(f)).length}`);

const all = readdirSync(DST).filter((f) => /\.jpg$/i.test(f)).sort()
  .map((f) => ({ name: f.replace(/\.jpg$/i, ''), file: f, dims: dims(`${DST}/${f}`) }));
writeFileSync('local-data/linkedin-photos/photos-hd-index.json', JSON.stringify(all, null, 2));
