// Upload the HD photos collected in photos-hd/ to Supabase Storage and point
// employees.photo_path at them.
//
// Dry run by default; pass --run to actually write.
//
// RLS requires a signed-in session, hence the E2E credentials (same approach as
// the original _upload_photos.mjs). Every upload resets photo_zoom/pan_x/pan_y,
// because a stored crop was framed for whatever image was there before.
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

config({ path: '.env.local' });
config({ path: '.env.test.local' });

const CHART_ID = 'e53b8650-0d48-47e1-b9f3-15465608b329';   // Base centrale des salariés
const BUCKET = 'employee-photos';
const DIR = 'local-data/linkedin-photos/photos-hd';

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const { error: authErr } = await supabase.auth.signInWithPassword({
  email: process.env.E2E_EMAIL,
  password: process.env.E2E_PASSWORD,
});
if (authErr) { console.error('auth failed:', authErr.message); process.exit(1); }

const { data: employees, error: fetchErr } = await supabase
  .from('employees')
  .select('id, first_name, last_name, photo_path')
  .eq('org_chart_id', CHART_ID);
if (fetchErr) { console.error('fetch employees:', fetchErr.message); process.exit(1); }

const byName = new Map(employees.map((e) => [norm(`${e.first_name} ${e.last_name}`), e]));

const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /\.jpg$/i.test(f)).sort() : [];
const todo = [];
const problems = [];
for (const file of files) {
  const stem = file.replace(/\.jpg$/i, '');
  const emp = byName.get(norm(stem));
  if (!emp) { problems.push(`no employee matches file: ${file}`); continue; }
  if (emp.photo_path) { problems.push(`already has a photo, skipping: ${stem}`); continue; }
  todo.push({ emp, file, path: `${DIR}/${file}` });
}

console.log(`files: ${files.length}   to upload: ${todo.length}   skipped: ${problems.length}`);
for (const p of problems) console.log('  !', p);

if (!process.argv.includes('--run')) {
  console.log('\n(dry run — pass --run to upload)');
  for (const t of todo) console.log('  would upload:', t.emp.first_name, t.emp.last_name);
  process.exit(0);
}

let ok = 0, fail = 0;
for (const t of todo) {
  const storagePath = `${t.emp.id}/${randomUUID()}.jpg`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, readFileSync(t.path), { contentType: 'image/jpeg', cacheControl: '3600', upsert: true });
  if (upErr) { console.log('FAIL upload', t.file, upErr.message); fail++; continue; }

  const { error: dbErr } = await supabase
    .from('employees')
    .update({ photo_path: storagePath, photo_zoom: 1, photo_pan_x: 0, photo_pan_y: 0 })
    .eq('id', t.emp.id)
    .select();
  if (dbErr) { console.log('FAIL db', t.file, dbErr.message); fail++; continue; }

  console.log('OK', `${t.emp.first_name} ${t.emp.last_name}`.padEnd(32), storagePath);
  ok++;
}
console.log(`\ndone — uploaded ${ok}, failed ${fail}`);
