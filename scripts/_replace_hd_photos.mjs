import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

config({ path: '.env.local' });
config({ path: '.env.test.local' });

const CHART_ID = 'e53b8650-0d48-47e1-b9f3-15465608b329';
const PHOTOS_DIR = 'local-data/linkedin-photos/photos';
const CSV_PATH = 'local-data/linkedin-photos/recap.csv';

// Input: JSON file with [{firstName, lastName, url}] where url is the signed HD LinkedIn URL
const INPUT_FILE = 'local-data/linkedin-photos/hd-urls.json';

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const { error: se } = await sb.auth.signInWithPassword({ email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD });
if (se) { console.error('auth:', se.message); process.exit(1); }

// Fetch all employees for this chart
const { data: employees, error: ee } = await sb.from('employees')
  .select('id, first_name, last_name, photo_path')
  .eq('org_chart_id', CHART_ID);
if (ee) { console.error(ee.message); process.exit(1); }

const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
const empByKey = new Map(employees.map((e) => [norm(`${e.first_name} ${e.last_name}`), e]));

// Load HD URLs
const hdUrls = JSON.parse(readFileSync(INPUT_FILE, 'utf8'));
console.log(`Processing ${hdUrls.length} HD photos...\n`);

const results = [];

for (const { firstName, lastName, url } of hdUrls) {
  const key = norm(`${firstName} ${lastName}`);
  const emp = empByKey.get(key);
  if (!emp) {
    console.log(`SKIP: ${firstName} ${lastName} — employee not found`);
    results.push({ firstName, lastName, status: 'not_found', url });
    continue;
  }

  if (url === 'noPhoto' || !url) {
    console.log(`SKIP: ${firstName} ${lastName} — no HD photo available`);
    results.push({ firstName, lastName, status: 'no_photo', url: url || '' });
    continue;
  }

  const localFile = `${PHOTOS_DIR}/${firstName} ${lastName}.jpg`;
  const localFilePng = `${PHOTOS_DIR}/${firstName} ${lastName}.png`;
  const ext = url.match(/crop_800_800|shrink_800_800|scale_800_800/) ? 'jpg' : 'jpg';

  // Download HD photo
  try {
    execSync(`curl -sL -o "${localFile}" "${url}"`, { timeout: 30000 });
    const size = parseInt(execSync(`stat -f%z "${localFile}"`).toString().trim());
    if (size < 5000) {
      console.log(`FAIL: ${firstName} ${lastName} — downloaded file too small (${size}b)`);
      results.push({ firstName, lastName, status: 'download_failed', url });
      continue;
    }
    const dims = execSync(`sips -g pixelWidth -g pixelHeight "${localFile}" 2>/dev/null`).toString();
    const w = dims.match(/pixelWidth:\s*(\d+)/)?.[1] || '';
    const h = dims.match(/pixelHeight:\s*(\d+)/)?.[1] || '';
    console.log(`DOWNLOADED: ${firstName} ${lastName} — ${w}×${h} (${size}b)`);

    // Upload to Supabase
    const buf = readFileSync(localFile);
    const uuid = randomUUID();
    const storagePath = `${emp.id}/${uuid}.jpg`;
    const { error: ue } = await sb.storage.from('employee-photos').upload(storagePath, buf, { contentType: 'image/jpeg', upsert: false });
    if (ue) {
      console.log(`  upload error: ${ue.message}`);
      results.push({ firstName, lastName, status: 'upload_failed', url, dims: `${w}x${h}` });
      continue;
    }

    // Update employee photo_path + reset crop
    const oldPath = emp.photo_path;
    const { error: pe } = await sb.from('employees').update({ photo_path: storagePath, photo_zoom: 1, photo_pan_x: 0, photo_pan_y: 0 }).eq('id', emp.id);
    if (pe) {
      console.log(`  update error: ${pe.message}`);
      results.push({ firstName, lastName, status: 'update_failed', url, dims: `${w}x${h}`, storagePath });
      continue;
    }

    // Delete old photo from storage
    if (oldPath) {
      const { error: de } = await sb.storage.from('employee-photos').remove([oldPath]);
      if (de) console.log(`  old photo delete failed: ${de.message}`);
    }

    console.log(`  UPLOADED: ${storagePath}`);
    results.push({ firstName, lastName, status: 'ok', url, dims: `${w}x${h}`, storagePath });
  } catch (err) {
    console.log(`ERROR: ${firstName} ${lastName} — ${err.message}`);
    results.push({ firstName, lastName, status: 'error', url, error: err.message });
  }

  // Pacing: 2s between downloads
  await new Promise((r) => setTimeout(r, 2000));
}

// Save results for CSV update
writeFileSync('local-data/linkedin-photos/hd-results.json', JSON.stringify(results, null, 2));
console.log(`\nDone. Results: ${results.filter(r => r.status === 'ok').length}/${hdUrls.length} OK`);
console.log('Results saved to hd-results.json');
