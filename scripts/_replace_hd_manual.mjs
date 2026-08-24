import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

config({ path: '.env.local' });
config({ path: '.env.test.local' });

const CHART_ID = 'e53b8650-0d48-47e1-b9f3-15465608b329';
const PHOTOS_DIR = 'local-data/linkedin-photos/photos';
const CSV_PATH = 'local-data/linkedin-photos/recap.csv';

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const { error: se } = await sb.auth.signInWithPassword({ email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD });
if (se) { console.error('auth:', se.message); process.exit(1); }

const { data: employees, error: ee } = await sb.from('employees')
  .select('id, first_name, last_name, photo_path')
  .eq('org_chart_id', CHART_ID);
if (ee) { console.error(ee.message); process.exit(1); }

const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();

const alias = {
  'he loise gambey': 'heloise gambey',
  'margaux kuipers': 'margaux kuipers',
  'lydia sabrine reggad': 'lydia sabrine reggad',
  'raphael de andreis': 'raphael de andreis',
  'andre as juge': 'andreas juge',
  'nishant chowdhari': 'nishant chowdhary',
  'luisa mejia': 'luisa mejia gomez',
};

const empByKey = new Map(employees.map((e) => [norm(`${e.first_name} ${e.last_name}`), e]));

// Parse CSV
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

const raw = readFileSync(CSV_PATH, 'utf8');
const all = parseCSV(raw);
const H = all[0];
const iFile = H.indexOf('photoFile');
const iPath = H.indexOf('photoPath');
const iW = H.indexOf('photoWidth');
const iH = H.indexOf('photoHeight');

// Measure all local files
const localDims = new Map(); // norm(stem) -> "WxH"
const files = readdirSync(PHOTOS_DIR).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
const sipsOut = execSync(`sips -g pixelWidth -g pixelHeight "${PHOTOS_DIR}"/*.jpg "${PHOTOS_DIR}"/*.png 2>/dev/null`, { shell: '/bin/zsh' }).toString();
let curFile = null;
for (const line of sipsOut.split('\n').filter((l) => l.trim())) {
  const m = line.match(/^\/.*\/([^/]+\.(?:jpg|png|jpeg)):?\s*$/i);
  if (m) { curFile = m[1]; continue; }
  const wm = line.match(/pixelWidth:\s*(\d+)/);
  const hm = line.match(/pixelHeight:\s*(\d+)/);
  if (wm && curFile) localDims.set(norm(curFile.replace(/\.(jpg|jpeg|png)$/i, '')), wm[1]);
  if (hm && curFile) {
    const key = norm(curFile.replace(/\.(jpg|jpeg|png)$/i, ''));
    const w = localDims.get(key);
    localDims.set(key, w ? `${w}x${hm[1]}` : hm[1]);
    curFile = null;
  }
}

// Find rows where local dims differ from CSV dims (= file was replaced with HD)
const toUpdate = [];
for (const r of all.slice(1)) {
  if (!r[iFile]) continue;
  let key = norm(r[iFile].replace(/\.(jpg|jpeg|png)$/i, ''));
  if (alias[key]) key = alias[key];
  const localD = localDims.get(key);
  if (!localD) continue;
  const csvD = `${r[iW]}x${r[iH]}`;
  if (localD !== csvD) {
    toUpdate.push({ row: r, localDims: localD, key });
  }
}

console.log(`Found ${toUpdate.length} files with changed dimensions:\n`);

let ok = 0, fail = 0;
for (const { row: r, localDims: d, key } of toUpdate) {
  const emp = empByKey.get(key);
  if (!emp) { console.log(`SKIP: ${r[0]} ${r[1]} — employee not found`); fail++; continue; }

  // Resolve local file — try exact name, then alternate extension
  const ext = r[iFile].match(/\.(png)$/i) ? 'png' : 'jpg';
  const altExt = ext === 'png' ? 'jpg' : 'png';
  const stem = r[iFile].replace(/\.(jpg|jpeg|png)$/i, '');
  let localFile = `${PHOTOS_DIR}/${r[iFile]}`;
  try { statSync(localFile); } catch {
    localFile = `${PHOTOS_DIR}/${stem}.${altExt}`;
    try { statSync(localFile); r[iFile] = `${stem}.${altExt}`; }
    catch { console.log(`SKIP: ${r[0]} ${r[1]} — file not found (${r[iFile]})`); fail++; continue; }
  }
  const realExt = localFile.match(/\.(png)$/i) ? 'png' : 'jpg';
  const [w, h] = d.split('x');

  // Upload new photo
  const buf = readFileSync(localFile);
  const uuid = randomUUID();
  const storagePath = `${emp.id}/${uuid}.${realExt}`;
  const { error: ue } = await sb.storage.from('employee-photos').upload(storagePath, buf, { contentType: `image/${realExt}`, upsert: false });
  if (ue) { console.log(`FAIL: ${r[0]} ${r[1]} — upload: ${ue.message}`); fail++; continue; }

  // Update employee photo_path + reset crop
  const oldPath = emp.photo_path;
  const { error: pe } = await sb.from('employees').update({ photo_path: storagePath, photo_zoom: 1, photo_pan_x: 0, photo_pan_y: 0 }).eq('id', emp.id);
  if (pe) { console.log(`FAIL: ${r[0]} ${r[1]} — update: ${pe.message}`); fail++; continue; }

  // Delete old photo
  if (oldPath) {
    const { error: de } = await sb.storage.from('employee-photos').remove([oldPath]);
    if (de) console.log(`  (old photo delete failed: ${de.message})`);
  }

  // Update CSV row
  r[iPath] = storagePath;
  r[iW] = w;
  r[iH] = h;

  console.log(`OK: ${r[0]} ${r[1]} — ${w}×${h} (was ${d}) → ${storagePath}`);
  ok++;

  await new Promise((res) => setTimeout(res, 500));
}

// Write updated CSV
const esc = (s) => (String(s).includes(';') || String(s).includes('"') ? `"${String(s).replace(/"/g, '""')}"` : String(s));
const out = [H, ...all.slice(1)].map((r) => r.map(esc).join(';')).join('\n');
writeFileSync(CSV_PATH, out + '\n');

console.log(`\nDone: ${ok} replaced, ${fail} failed`);
console.log('CSV updated with new photoPath and dimensions.');
