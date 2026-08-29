// Which of the 122 employees still have no photo file on disk?
// Cross-checks the registry list against photos-hd/ using the same
// accent-insensitive normalisation the rest of the pipeline uses.
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

const emps = JSON.parse(readFileSync('local-data/linkedin-photos/employees-without-photo-2026-08-29.json', 'utf8'));
const DIR = 'local-data/linkedin-photos/photos-hd';
const have = new Set(
  (existsSync(DIR) ? readdirSync(DIR) : [])
    .filter((f) => /\.jpg$/i.test(f))
    .map((f) => norm(f.replace(/\.jpg$/i, ''))),
);

const missing = emps.filter((e) => !have.has(norm(`${e.first_name} ${e.last_name}`)));
console.log(`have: ${have.size} / ${emps.length}   missing: ${missing.length}\n`);
for (const m of missing) console.log(`  ${m.first_name} ${m.last_name}  —  ${m.job_title || '?'} / ${m.department || '?'}`);
