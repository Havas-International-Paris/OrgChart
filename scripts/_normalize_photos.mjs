import { readFileSync, writeFileSync, readdirSync, existsSync, renameSync, unlinkSync, statSync } from 'node:fs';

const BASE = '/Users/NICOLAS.DEVULPIAN/Vibecoding/Orgchart';
const PHOTOS = `${BASE}/local-data/linkedin-photos/photos`;
const emps = JSON.parse(readFileSync(`${BASE}/local-data/linkedin-photos/employees-without-photo.json`, 'utf8'));

const norm = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const registry = new Map();
for (const e of emps) {
  const key = norm(`${e.first_name} ${e.last_name}`);
  if (key) registry.set(key, e);
}

// alias map: normalized on-disk stem -> normalized registry key
const alias = {
  'he loise gambey': 'heloise gambey',
  'margaux kuipers': 'margaux kuipers',
  'lydia sabrine reggad': 'lydia sabrine reggad',
  'raphael de andreis': 'raphael de andreis',
  'andre as juge': 'andreas juge',
  'nishant chowdhari': 'nishant chowdhary',
  'luisa mejia': 'luisa mejia gomez',
};

const files = readdirSync(PHOTOS).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));

// map employee_id -> best file (largest, so recent high-res wins over the
// small auto-downloaded jpg duplicates)
const best = new Map(); // employee_id -> {file, size}
const fileEmp = new Map(); // file -> employee_id
for (const f of files) {
  const stem = f.replace(/\.(jpg|jpeg|png)$/i, '');
  let key = norm(stem);
  if (alias[key]) key = alias[key];
  const emp = registry.get(key);
  if (!emp) { console.log('UNMATCHED:', f); continue; }
  fileEmp.set(f, emp.employee_id);
  const sz = statSync(`${PHOTOS}/${f}`).size;
  const cur = best.get(emp.employee_id);
  if (!cur || sz > cur.size) best.set(emp.employee_id, { file: f, size: sz });
}

// delete duplicates, rename winners to canonical "First Last.ext"
const toDel = [];
for (const f of files) {
  const id = fileEmp.get(f);
  if (!id) continue;
  if (best.get(id).file !== f) toDel.push(f);
}
for (const f of toDel) { unlinkSync(`${PHOTOS}/${f}`); console.log('deleted dup:', f); }

const renamed = [];
for (const [id, { file }] of best) {
  const emp = emps.find((e) => e.employee_id === id);
  const ext = file.replace(/^.*\.(jpg|jpeg|png)$/i, (m, e) => e.toLowerCase());
  const target = `${emp.first_name} ${emp.last_name}.${ext === 'jpeg' ? 'jpg' : ext}`;
  if (file === target) continue;
  const from = `${PHOTOS}/${file}`;
  const to = `${PHOTOS}/${target}`;
  if (existsSync(to) && to !== from) {
    // conflict: another employee claims this name? keep the larger
    if (statSync(from).size > statSync(to).size) { unlinkSync(to); renameSync(from, to); renamed.push(`${file} -> ${target}`); }
    else unlinkSync(from);
    continue;
  }
  renameSync(from, to);
  renamed.push(`${file} -> ${target}`);
}
for (const r of renamed) console.log('renamed:', r);

console.log('--- final files ---');
console.log(readdirSync(PHOTOS).filter((f) => /\.(jpg|jpeg|png)$/i.test(f)).sort().join('\n'));
