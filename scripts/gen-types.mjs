#!/usr/bin/env node
// Regenerates src/lib/database.types.ts from the live Supabase schema, so it
// stops being hand-authored and drifting from supabase/migrations/*.sql.
//
// Why a script rather than a bare npm script: the project ref has to come from
// somewhere (it lives in .env.local, not in package.json), and — more
// importantly — a bare `supabase gen types ... > src/lib/database.types.ts`
// truncates the target file *before* the CLI runs. Any failure (not logged in,
// no network, wrong ref) would leave an empty types file behind and break the
// build with an error pointing nowhere near the cause. This captures the
// output, validates it, and only then writes.
//
// Requires the Supabase CLI to be authenticated, which is interactive and
// therefore a one-off manual step:
//     npx supabase login
// Or, in CI, set SUPABASE_ACCESS_TOKEN in the environment instead.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env.local');
const outPath = resolve(root, 'src/lib/database.types.ts');

function fail(message, hint) {
  console.error(`\n✖ ${message}`);
  if (hint) console.error(`  → ${hint}`);
  console.error('');
  process.exit(1);
}

let env;
try {
  env = readFileSync(envPath, 'utf8');
} catch {
  fail('.env.local not found.', 'Copy .env.example and fill in the project URL and anon key.');
}

// The project ref is the first label of the Supabase project URL, e.g.
// https://abcdefghijklm.supabase.co → abcdefghijklm.
const urlMatch = env.match(/^VITE_SUPABASE_URL\s*=\s*"?(https:\/\/([a-z0-9]+)\.supabase\.co)"?\s*$/m);
if (!urlMatch) {
  fail(
    'Could not read a Supabase project URL from .env.local.',
    'VITE_SUPABASE_URL must look like https://<ref>.supabase.co',
  );
}
const projectRef = urlMatch[2];

console.log(`Generating types for project ${projectRef}…`);

let generated;
try {
  generated = execFileSync(
    'npx',
    ['--yes', 'supabase@latest', 'gen', 'types', 'typescript', '--project-id', projectRef],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], cwd: root },
  );
} catch {
  fail(
    'The Supabase CLI failed (see its output above).',
    'Most often this means it is not authenticated — run `npx supabase login` once, or set SUPABASE_ACCESS_TOKEN.',
  );
}

// Validate before writing: the whole point of buffering the output is that a
// truncated or error-shaped response must never overwrite a working types file.
if (!/export\s+(type|interface)\s+Database\b/.test(generated)) {
  fail(
    'The CLI output does not look like a types file — nothing was written.',
    'Run the CLI by hand to see what it returned.',
  );
}
// supabaseClient.ts imports { Database } from this file; nothing else in the app
// imports anything from it, so a full replacement is safe. Guard anyway, since
// that is the one thing a regeneration must not break.
if (!/\bTables:/.test(generated)) {
  fail('The CLI output has no Tables block — nothing was written.');
}

const header = [
  '// GENERATED FILE — do not edit by hand.',
  '// Regenerate with `npm run gen:types` after applying a migration.',
  `// Source: Supabase project ${projectRef}`,
  '',
  '',
].join('\n');

const previous = (() => {
  try {
    return readFileSync(outPath, 'utf8');
  } catch {
    return '';
  }
})();

writeFileSync(outPath, header + generated);

if (previous && previous.replace(header, '') === generated) {
  console.log('✔ src/lib/database.types.ts was already up to date.');
} else {
  console.log('✔ src/lib/database.types.ts regenerated.');
  console.log('  Run `npm run build` — a schema change may have broken a call site.');
}
