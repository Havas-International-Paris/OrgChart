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
// Two ways to reach the schema, and the first is preferred on purpose:
//
//   1. SUPABASE_DB_URL — the project's Postgres connection string. Scoped to
//      this one database and nothing else. Pass it for a single run without
//      writing the password to disk:
//          SUPABASE_DB_URL='postgresql://...' npm run gen:types
//      Use the *Session pooler* string from the dashboard's Connect modal, not
//      the "Direct connection" one — same reason the backup workflow does (the
//      direct host is IPv6-only). Also read from .env.local if you would rather
//      keep it there; that file is gitignored.
//
//   2. `npx supabase login` — falls back to --project-id. Note this is an
//      ACCOUNT-level token, not a per-project one: it grants the CLI access to
//      every organization and project the account can see, and Supabase
//      Personal Access Tokens cannot be scoped to a single project. Prefer (1)
//      unless you specifically want the CLI logged in for other reasons.
//      SUPABASE_ACCESS_TOKEN works the same way in CI.

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

// Environment first so a one-off `SUPABASE_DB_URL=... npm run gen:types` never
// has to touch a file; .env.local second for convenience if you'd rather keep it.
const dbUrl =
  process.env.SUPABASE_DB_URL?.trim() ||
  env.match(/^SUPABASE_DB_URL\s*=\s*"?([^"\s]+)"?\s*$/m)?.[1] ||
  '';

// The connection string carries the database password, so it must never be
// echoed — not into the console, not into an error message.
const args = dbUrl
  ? ['--yes', 'supabase@latest', 'gen', 'types', 'typescript', '--db-url', dbUrl]
  : ['--yes', 'supabase@latest', 'gen', 'types', 'typescript', '--project-id', projectRef];

console.log(
  dbUrl
    ? `Generating types for project ${projectRef} via its database connection…`
    : `Generating types for project ${projectRef} via the Management API (account login)…`,
);

let generated;
try {
  generated = execFileSync('npx', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    cwd: root,
  });
} catch {
  fail(
    'The Supabase CLI failed (see its output above).',
    dbUrl
      ? 'Check the connection string — use the dashboard\'s Session pooler string, not the IPv6-only "Direct connection" one.'
      : 'Most often this means the CLI is not authenticated. Either set SUPABASE_DB_URL (scoped to this one database — preferred) or run `npx supabase login` (an account-wide token).',
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
