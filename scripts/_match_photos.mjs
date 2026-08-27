import { readFileSync, writeFileSync, readdirSync, existsSync, renameSync } from 'node:fs';

const BASE = '/Users/NICOLAS.DEVULPIAN/Vibecoding/Orgchart';
const PHOTOS = `${BASE}/local-data/linkedin-photos/photos`;
const emps = JSON.parse(readFileSync(`${BASE}/local-data/linkedin-photos/employees-without-photo.json`, 'utf8'));

// ---- name normalization: lowercase, strip accents, collapse non-alpha ----
const norm = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// registry names keyed by normalized "first last"
const registry = new Map();
for (const e of emps) {
  const key = norm(`${e.first_name} ${e.last_name}`);
  if (key) registry.set(key, e);
}

const files = readdirSync(PHOTOS).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));

// known filename -> registry corrections (user typed names with caps/accents/typos)
const override = {
  'he loise gambey': 'heloise gambey',
  'margaux kuipers': 'margaux kuipers',
  'lydia sabrine reggad': 'lydia sabrine reggad',
  'samuel mikael': 'samuel mikael',
  'raphael de andreis': 'raphael de andreis',
  'andre as juge': 'andreas juge',
  'nishant chowdhari': 'nishant chowdhary',
  'lea collinet': 'lea collinet',
  'mathilde aubourg': 'mathilde aubourg',
  'camille planchot': 'camille planchot',
  'vianney de larminat': 'vianney de larminat',
  'christelle volet': 'christelle volet',
  'mane mann': '',
};

const matched = [];
const unmatched = [];
const dup = [];
const seen = new Set();

for (const f of files.sort()) {
  const stem = f.replace(/\.(jpg|jpeg|png)$/i, '');
  let key = norm(stem);
  if (override[key] !== undefined && override[key] !== '') key = override[key];
  const emp = registry.get(key);
  if (!emp) {
    unmatched.push(f);
    continue;
  }
  if (seen.has(emp.employee_id)) {
    dup.push({ file: f, emp: `${emp.first_name} ${emp.last_name}`, winner: files.find((x) => {
      const k = norm(x.replace(/\.(jpg|jpeg|png)$/i, ''));
      const o = override[k] ?? k;
      const r = registry.get(o);
      return r && r.employee_id === emp.employee_id && x !== f;
    }) });
    continue;
  }
  seen.add(emp.employee_id);
  matched.push({ file: f, emp });
}

console.log('files:', files.length);
console.log('matched:', matched.length);
for (const m of matched) console.log('  OK  ', m.file, '=>', `${m.emp.first_name} ${m.emp.last_name}`);
console.log('duplicates:', dup.length);
for (const d of dup) console.log('  DUP ', d.file, '(kept', d.winner + ')');
console.log('unmatched:', unmatched.length);
for (const u of unmatched) console.log('  !!  ', u);

writeFileSync('/tmp/photo_match.json', JSON.stringify({ matched, dup, unmatched }, null, 2));
