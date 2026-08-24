import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
config({ path: '.env.local' });
config({ path: '.env.test.local' });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const { error: se } = await supabase.auth.signInWithPassword({ email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD });
if (se) { console.error(se.message); process.exit(1); }

const CHART_ID = 'e53b8650-0d48-47e1-b9f3-15465608b329';
const { data: emps, error } = await supabase
  .from('employees')
  .select('id, first_name, last_name, job_title, department, photo_path')
  .eq('org_chart_id', CHART_ID)
  .is('photo_path', null)
  .order('last_name');

if (error) { console.error(error.message); process.exit(1); }

const rows = emps.map((e, i) => ({ index: i, employee_id: e.id, first_name: e.first_name, last_name: e.last_name, job_title: e.job_title, department: e.department }));
writeFileSync('local-data/linkedin-photos/employees-without-photo.json', JSON.stringify(rows, null, 2));
console.log('wrote', rows.length, 'rows');

const csv = ['last_name,first_name,job_title,department'].concat(
  emps.map((e) => [e.last_name, e.first_name, e.job_title ?? '', e.department ?? ''].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','))
).join('\n');
writeFileSync('local-data/linkedin-photos/employees-without-photo.csv', csv);
console.log('csv written');

const flat = rows.map((r) => [r.last_name, r.first_name].filter(Boolean).join(' '));
console.log(flat.join('\n'));