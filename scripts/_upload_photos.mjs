import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

config({ path: '.env.local' });
config({ path: '.env.test.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const { error: se } = await supabase.auth.signInWithPassword({
  email: process.env.E2E_EMAIL,
  password: process.env.E2E_PASSWORD,
});
if (se) { console.error('auth:', se.message); process.exit(1); }

const CHART_ID = 'e53b8650-0d48-47e1-b9f3-15465608b329';
const BUCKET = 'employee-photos';
const BASE = 'local-data/linkedin-photos/photos';

// ---- load the photo list from recap.csv (authoritative: file -> employee) ----
import { readFileSync as rfs } from 'node:fs';
const csvRaw = rfs('local-data/linkedin-photos/recap.csv', 'utf8');
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
const rows = parseCSV(csvRaw);
const names = rows.slice(1).filter((r) => r[3]).map((r) => ({ first: r[0], last: r[1], file: r[3] }));

// ---- resolve employee ids from the registry (fresh query to get photo_path) ----
const { data: employees, error: ee } = await supabase
  .from('employees')
  .select('id, first_name, last_name, photo_path')
  .eq('org_chart_id', CHART_ID);
if (ee) { console.error('fetch employees:', ee.message); process.exit(1); }

const empById = new Map(employees.map((e) => [`${e.first_name} ${e.last_name}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(), e]));

const toUpload = [];
for (const n of names) {
  const key = `${n.first} ${n.last}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const emp = empById.get(key);
  if (!emp) { console.log('NOT FOUND in registry:', n.first, n.last); continue; }
  const path = `${BASE}/${n.file}`;
  if (!statSync(path).isFile()) { console.log('missing file:', n.file); continue; }
  if (emp.photo_path) { console.log('ALREADY HAS PHOTO, skip:', n.first, n.last, emp.photo_path); continue; }
  toUpload.push({ emp, file: n.file, path });
}

console.log('\n== would upload', toUpload.length, '==');
for (const u of toUpload) console.log('  ', u.emp.first_name, u.emp.last_name, '<-', u.file);

// ---- DRY RUN unless --run ----
if (!process.argv.includes('--run')) {
  console.log('\n(dry run — add --run to actually upload)');
  process.exit(0);
}

let ok = 0, fail = 0;
for (const u of toUpload) {
  const ext = u.file.split('.').pop();
  const blob = readFileSync(u.path);
  const storagePath = `${u.emp.id}/${randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, blob, { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`, cacheControl: '3600', upsert: true });
  if (upErr) { console.log('FAIL upload', u.emp.first_name, u.emp.last_name, ':', upErr.message); fail++; continue; }
  const { error: dbErr } = await supabase
    .from('employees')
    .update({ photo_path: storagePath, photo_zoom: 1, photo_pan_x: 0, photo_pan_y: 0 })
    .eq('id', u.emp.id)
    .select();
  if (dbErr) { console.log('FAIL db update', u.emp.first_name, u.emp.last_name, ':', dbErr.message); fail++; continue; }
  console.log('OK', u.emp.first_name, u.emp.last_name, '->', storagePath);
  ok++;
}
console.log('\nDONE ok=', ok, 'fail=', fail);
