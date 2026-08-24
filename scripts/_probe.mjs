import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env.test.local' });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
await supabase.auth.signInWithPassword({ email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD });

const { data: emps, error } = await supabase
  .from('employees')
  .select('id, first_name, last_name, job_title, department, photo_path')
  .eq('org_chart_id', 'e53b8650-0d48-47e1-b9f3-15465608b329')
  .is('photo_path', null)
  .order('last_name');

console.log('error:', error ? JSON.stringify(error) : 'none');
console.log('returned:', Array.isArray(emps) ? emps.length : typeof emps);
if (Array.isArray(emps)) {
  const total = await supabase.from('employees').select('id', { count: 'exact', head: true }).eq('org_chart_id', 'e53b8650-0d48-47e1-b9f3-15465608b329');
  console.log('total in registry:', total.count);
  for (const e of emps) console.log(`- ${e.last_name}, ${e.first_name} | ${e.job_title ?? ''} | ${e.department ?? ''}`);
}
