// Sync recap.csv with the real state after the 2026-08-29 HD import.
//
// recap.csv stays the authoritative record of who has been processed and with
// what outcome. Rows from the August run are preserved as-is; this run's 122
// employees are added or updated, with photoPath read back from the live
// database (not assumed) and pixel dimensions measured from the actual file.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env.test.local' });

const CSV = 'local-data/linkedin-photos/recap.csv';
const DIR = 'local-data/linkedin-photos/photos-hd';
const CHART_ID = 'e53b8650-0d48-47e1-b9f3-15465608b329';

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

// Why each unresolved employee is unresolved — recorded from the live profile
// checks, so the next run does not repeat them blindly.
const REASONS = {
  'Diane Baddy Dega': 'Profil Havas Market confirme (Consultante SEA) mais LinkedIn n expose aucune photo au-dela de 100x100',
  'Brice Rontey': 'Profil trouve mais LinkedIn n expose aucune photo au-dela de 100x100',
  'Anaëlle Bary': 'Seul candidat = Anaelle Tabary (Ingenieure Process, SUEZ) : homonyme',
  'Gabriel Bascou': 'Homonyme exact mais photographe freelance a son compte, pas media',
  'Lucile Berthoud': 'Candidats = Lucille Duprat (Havas Paris), Lucie Berthoud (CHRU Tours), Lucy Berthoud',
  'Philippe Bigot': 'Trois homonymes : Safran, Reseau Entreprendre, FDJ',
  'Thomas Boffo': 'Homonyme : owner hitchhiker.travel',
  'Zakiya Boujida': 'Candidats = Zakkiyya Ahmed (Havas Media) et Zakaria Boujida (Casablanca)',
  'Imane Bouziza': 'Candidat = Imane E. (Havas Edge), nom de famille masque, non verifiable',
  'Nil Coma': 'Homonyme : Nil Comas, Project Manager ILAMCO',
  'Geoffrey Courbon': 'Slug devine en 404, seul candidat Bing = Remi Courbon',
  'Cristina Cucos': 'Homonyme : Cristina-Alina Cucos, CECCAR Bucarest',
  'Elie Cuny': 'Slug devine en 404, candidats Bing = Elodie / Elise Cuny',
  'Stéphanie Da Costa': 'Trois homonymes : Univ. Pittsburgh, CCI Seine-et-Marne, Laboratoires Thea',
  'Gloria d\'Agostin': 'Homonyme : Gloria Agostini, o9 Solutions',
  'Feyrouze El Miniti': 'Candidat = Feyrouze Azizi, nom different',
  'Sébastien Emeriau': 'Homonyme : chef de projet Satys Interior',
  'Imen Fathallah': 'Homonyme : Senior PM CRM chez VO2 Group',
  'Maxime Faucher': 'Homonyme : Responsable Infrastructure chez Tessi',
  'Guillaume Ferrandez': 'Seul candidat = Guillaume Havas (patronyme Havas), personne differente',
  'Romain Hennequin': 'Homonyme : responsable developpement chez Apimo',
  'Armelle Henry': 'Homonyme AdOps mais employeur Oreegami Academy, pas Havas',
  'Marion Hourtoule': 'Seul candidat = Marion Havas (patronyme Havas), personne differente',
  'Camille Jouannic': 'Homonyme : etudiante ingenieure, Valeco',
  'Oumy Keita': 'Candidat = Oumou Keita, Citi : prenom et employeur differents',
  'Thomas Lapeyre': 'Profil trouve mais aucun employeur Havas visible',
  'Julie Laurent': 'Homonyme : conseillere location Century 21',
  'Valérie Lavaud': 'Homonyme : cadre fonction publique, Departement de la Gironde',
  'Christian Mbida': 'Homonyme : Christian Embolo Mbida, etudiant ESIEA',
  'Marianne Nowak': 'Homonyme : Directrice des Operations, BGFIBank Europe',
  'Isabel Pires': 'Homonyme : MsC Finance Nova SBE, Samlino Group',
  'Antoine Ribeiro': 'Homonyme : MSc Financial Engineering, Credit Agricole',
  'Pierre Riboulet': 'Homonyme : Tech Lead chez CGI',
  'Margot Rodrigues': 'Homonyme : conseillere clientele Banque CIC Est',
  'Constance Roussel': 'Homonyme : Finance/HCM Systems chez Workday',
  'Nicolas Russotto': 'Homonyme base en Argentine',
  'Céline Tavian': 'Homonyme : Gestore Retail BNL BNP Paribas',
};

function parseCSV(text, delim = ';') {
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else if (c === '"') inQ = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c === '\r') { /* skip */ }
    else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const dims = (p) => {
  try {
    const o = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', p], { encoding: 'utf8' });
    return [(o.match(/pixelWidth:\s*(\d+)/) || [])[1] || '', (o.match(/pixelHeight:\s*(\d+)/) || [])[1] || ''];
  } catch { return ['', '']; }
};

// ---- live state -----------------------------------------------------------
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const { error: authErr } = await supabase.auth.signInWithPassword({
  email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD,
});
if (authErr) { console.error('auth:', authErr.message); process.exit(1); }
const { data: emps, error } = await supabase
  .from('employees').select('id, first_name, last_name, photo_path').eq('org_chart_id', CHART_ID);
if (error) { console.error(error.message); process.exit(1); }
const liveByName = new Map(emps.map((e) => [norm(`${e.first_name} ${e.last_name}`), e]));

// ---- this run's cohort ----------------------------------------------------
const cohort = JSON.parse(readFileSync('local-data/linkedin-photos/employees-without-photo-2026-08-29.json', 'utf8'));
const haveFile = new Map(
  (existsSync(DIR) ? readdirSync(DIR) : []).filter((f) => /\.jpg$/i.test(f))
    .map((f) => [norm(f.replace(/\.jpg$/i, '')), f]),
);

const rows = parseCSV(readFileSync(CSV, 'utf8'));
const header = rows[0];
const existing = new Map(rows.slice(1).map((r) => [norm(`${r[0]} ${r[1]}`), r]));

let added = 0, updated = 0;
for (const e of cohort) {
  const key = norm(`${e.first_name} ${e.last_name}`);
  const live = liveByName.get(key);
  const file = haveFile.get(key) || '';
  const [w, h] = file ? dims(`${DIR}/${file}`) : ['', ''];
  const uploaded = !!(live && live.photo_path);
  const status = uploaded ? 'confirmed' : 'not_found';
  const reason = uploaded
    ? 'Import HD 2026-08-29 : profil LinkedIn confirme (nom + employeur groupe Havas), photo originale telechargee'
    : (REASONS[`${e.first_name} ${e.last_name}`] || 'Aucun profil LinkedIn confirme (URL a fournir)');

  const row = existing.get(key) || new Array(header.length).fill('');
  row[0] = e.first_name; row[1] = e.last_name; row[2] = status; row[3] = file;
  row[7] = reason;
  row[9] = live && live.photo_path ? live.photo_path : '';
  row[10] = w; row[11] = h;
  if (existing.has(key)) updated++; else { rows.push(row); added++; }
}

const esc = (s) => { s = String(s ?? ''); return (s.includes(';') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
writeFileSync(CSV, rows.map((r) => r.map(esc).join(';')).join('\n') + '\n');

const done = cohort.filter((e) => { const l = liveByName.get(norm(`${e.first_name} ${e.last_name}`)); return l && l.photo_path; });
console.log(`recap.csv: ${rows.length - 1} rows total (${added} added, ${updated} updated)`);
console.log(`cohort 2026-08-29: ${done.length}/${cohort.length} with a photo in the database`);
