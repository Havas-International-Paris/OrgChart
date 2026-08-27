import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const BASE = '/Users/NICOLAS.DEVULPIAN/Vibecoding/Orgchart';
const CSV = `${BASE}/local-data/linkedin-photos/recap.csv`;
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

const alias = {
  'he loise gambey': 'heloise gambey',
  'margaux kuipers': 'margaux kuipers',
  'lydia sabrine reggad': 'lydia sabrine reggad',
  'raphael de andreis': 'raphael de andreis',
  'andre as juge': 'andreas juge',
  'nishant chowdhari': 'nishant chowdhary',
  'luisa mejia': 'luisa mejia gomez',
};

// file stem (normalized) -> registry employee
const files = readdirSync(PHOTOS).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
const fileEmp = new Map();
for (const f of files) {
  let key = norm(f.replace(/\.(jpg|jpeg|png)$/i, ''));
  if (alias[key]) key = alias[key];
  const emp = emps.find((e) => norm(`${e.first_name} ${e.last_name}`) === key);
  if (emp) fileEmp.set(norm(`${emp.first_name} ${emp.last_name}`), f);
}

// parse recap.csv (semicolon, quoted fields)
function parseCSV(text, delim = ';') {
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else if (c === '"') inQ = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c === '\r') {}
    else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const rows = parseCSV(readFileSync(CSV, 'utf8'));
const h = rows[0];
const nameIdx = 0, lastIdx = 1, fileIdx = 3;
let updated = 0;
for (const r of rows.slice(1)) {
  const key = norm(`${r[nameIdx]} ${r[lastIdx]}`);
  const f = fileEmp.get(key);
  if (f && r[fileIdx] !== f) { r[fileIdx] = f; updated++; }
  else if (!f && r[fileIdx]) { r[fileIdx] = ''; updated++; }
}

// quote only reason field if it contains the delimiter or quotes
const esc = (s) => (s.includes(';') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s);
const out = rows.map((r) => r.map(esc).join(';')).join('\n');
writeFileSync(CSV, out + '\n');
console.log('rows updated:', updated);
console.log('photoFile filled:', rows.slice(1).filter((r) => r[fileIdx]).length, '/', rows.length - 1);
for (const r of rows.slice(1)) if (r[fileIdx]) console.log('  ', r[nameIdx], r[lastIdx], '=>', r[fileIdx]);
