import { readFileSync, writeFileSync } from 'node:fs';

const CSV_PATH = 'local-data/linkedin-photos/recap.csv';
const RESULTS_FILE = 'local-data/linkedin-photos/hd-results.json';

const results = JSON.parse(readFileSync(RESULTS_FILE, 'utf8'));
const resBy = new Map(results.map((r) => [`${r.firstName}|${r.lastName}`, r]));

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
const iUrl = H.indexOf('photoUrl');
const iPath = H.indexOf('photoPath');
const iW = H.indexOf('photoWidth');
const iH = H.indexOf('photoHeight');

let updated = 0;
for (const r of all.slice(1)) {
  const key = `${r[0]}|${r[1]}`;
  const res = resBy.get(key);
  if (!res) continue;
  if (res.status === 'ok' && res.storagePath) {
    if (r[iUrl] !== res.url || r[iPath] !== res.storagePath) {
      r[iUrl] = res.url;
      r[iPath] = res.storagePath;
      const [w, h] = res.dims ? res.dims.split('x') : ['', ''];
      r[iW] = w;
      r[iH] = h;
      updated++;
    }
  } else if (res.status === 'no_photo' && res.url === 'noPhoto') {
    // leave as-is
  }
}

const esc = (s) => (String(s).includes(';') || String(s).includes('"') ? `"${String(s).replace(/"/g, '""')}"` : String(s));
const out = [H, ...all.slice(1)].map((r) => r.map(esc).join(';')).join('\n');
writeFileSync(CSV_PATH, out + '\n');
console.log(`CSV updated: ${updated} rows with HD URLs/dimensions`);
