import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

config({ path: '.env.local' });
config({ path: '.env.test.local' });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const { error: se } = await supabase.auth.signInWithPassword({ email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD });
if (se) { console.error('auth:', se.message); process.exit(1); }

const CHART_ID = 'e53b8650-0d48-47e1-b9f3-15465608b329';
const { data: employees, error: ee } = await supabase
  .from('employees')
  .select('id, first_name, last_name, photo_path')
  .eq('org_chart_id', CHART_ID);
if (ee) { console.error(ee.message); process.exit(1); }

const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
const empByKey = new Map(employees.map((e) => [norm(`${e.first_name} ${e.last_name}`), e]));

const csvRaw = readFileSync('local-data/linkedin-photos/recap.csv', 'utf8');
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

// header: append photoPath + photoWidth + photoHeight only if not already present
const H = rows[0].includes('photoPath') ? rows[0] : [...rows[0], 'photoPath', 'photoWidth', 'photoHeight'];

// measure local files via sips for all photoFile names at once
const localDir = 'local-data/linkedin-photos/photos';
const dims = new Map(); // "First Last" normalized -> "WxH"
const files = execSync(`sips -g pixelWidth -g pixelHeight "${localDir}"/*.jpg "${localDir}"/*.png 2>/dev/null`, { shell: '/bin/zsh' }).toString();
const tokens = files.split('\n').filter((l) => l.trim());
let curFile = null;
for (const line of tokens) {
  const m = line.match(/^\/.*\/([^/]+\.(?:jpg|png|jpeg)):?\s*$/i);
  if (m) { curFile = m[1]; continue; }
  const wm = line.match(/pixelWidth:\s*(\d+)/);
  const hm = line.match(/pixelHeight:\s*(\d+)/);
  if (wm && curFile) dims.set(norm(curFile.replace(/\.(jpg|jpeg|png)$/i, '')), wm[1]);
  if (hm && curFile) {
    const key = norm(curFile.replace(/\.(jpg|jpeg|png)$/i, ''));
    const w = dims.get(key);
    dims.set(key, w ? `${w}x${hm[1]}` : hm[1]);
    curFile = null;
  }
}

let wrows = 0;
const iPath = H.indexOf('photoPath');
const iW = H.indexOf('photoWidth');
const iH = H.indexOf('photoHeight');
for (const r of rows.slice(1)) {
  // pad row to header length if it's missing the trailing columns
  while (r.length < H.length) r.push('');
  const key = norm(`${r[0]} ${r[1]}`);
  const emp = empByKey.get(key);
  const path = emp && emp.photo_path ? emp.photo_path : '';
  const d = dims.get(r[3] ? norm(r[3].replace(/\.(jpg|jpeg|png)$/i, '')) : '');
  const [w, h] = d ? d.split('x') : ['', ''];
  r[iPath] = path;
  r[iW] = w;
  r[iH] = h;
  if (path) wrows++;
}

const esc = (s) => (String(s).includes(';') || String(s).includes('"') ? `"${String(s).replace(/"/g, '""')}"` : String(s));
const out = [H, ...rows.slice(1)].map((r) => r.map(esc).join(';')).join('\n');
writeFileSync('local-data/linkedin-photos/recap.csv', out + '\n');
console.log('photoPath filled:', wrows, '/', rows.length - 1);
console.log('sample:', out.split('\n').slice(0, 4).join('\n'));