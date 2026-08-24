import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import 'dotenv/config';

config({ path: '.env.local' });

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

const { data: charts, error: errCharts } = await supabase
  .from('org_charts')
  .select('id, name, short_label');

if (errCharts) {
  console.error('Charts error:', errCharts.message);
  process.exit(1);
}

console.log('=== ORG CHARTS ===');
for (const c of charts ?? []) {
  const { count } = await supabase
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .eq('org_chart_id', c.id);
  console.log(`${c.id}\t${c.name}\t${count ?? 0} employees`);
}