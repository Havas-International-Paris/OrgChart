// Verify the live state of employees.photo_path in the central registry, and
// confirm each stored object is actually reachable in the public bucket.
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env.test.local' });

const CHART_ID = 'e53b8650-0d48-47e1-b9f3-15465608b329';
const BUCKET = 'employee-photos';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const { error: authErr } = await supabase.auth.signInWithPassword({
  email: process.env.E2E_EMAIL,
  password: process.env.E2E_PASSWORD,
});
if (authErr) { console.error('auth:', authErr.message); process.exit(1); }

const { data: emps, error } = await supabase
  .from('employees')
  .select('id, first_name, last_name, photo_path')
  .eq('org_chart_id', CHART_ID)
  .order('last_name');
if (error) { console.error(error.message); process.exit(1); }

const withPhoto = emps.filter((e) => e.photo_path);
const without = emps.filter((e) => !e.photo_path);

console.log(`registry employees:   ${emps.length}`);
console.log(`  with photo_path:    ${withPhoto.length}`);
console.log(`  without:            ${without.length}`);

// Spot-check that the stored objects really resolve (a photo_path pointing at
// nothing is worse than a null, because the UI shows a broken image).
let checked = 0, broken = [];
for (const e of withPhoto) {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(e.photo_path);
  const res = await fetch(data.publicUrl, { method: 'HEAD' });
  checked++;
  if (!res.ok) broken.push(`${e.first_name} ${e.last_name} -> ${res.status}`);
}
console.log(`\nstorage objects checked: ${checked}, broken: ${broken.length}`);
for (const b of broken) console.log('  BROKEN', b);

console.log('\nstill without a photo:');
for (const e of without) console.log(`  ${e.first_name} ${e.last_name}`);
