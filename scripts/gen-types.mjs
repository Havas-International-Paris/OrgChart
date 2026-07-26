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
// Two ways to reach the schema. Which one is actually better depends on whether
// this machine has a container runtime, which is not obvious from the CLI's docs:
//
//   1. `npx supabase login` (no SUPABASE_DB_URL set) — uses --project-id and the
//      Management API. Needs NOTHING installed. The catch is that the CLI's token
//      is ACCOUNT-level, not per-project: it grants access to every organization
//      and project the account can see, and Supabase Personal Access Tokens
//      cannot be scoped to one project. `npx supabase logout` right after
//      generating limits the window. SUPABASE_ACCESS_TOKEN works the same way
//      in CI. This is the route that works on a stock machine.
//
//   2. SUPABASE_DB_URL — uses --db-url, scoped to this one database and nothing
//      else, so it needs no account token at all:
//          SUPABASE_DB_URL='postgresql://...' npm run gen:types
//      But `gen types --db-url` does NOT connect to Postgres directly: it spawns
//      a containerised postgres-meta image, so it REQUIRES docker or podman. On a
//      machine without one it fails as `NotFound: ChildProcess.spawn (podman run
//      ...)`, which reads like a network or credential error and is neither.
//      Use the *Session pooler* string from the dashboard's Connect modal, not
//      the "Direct connection" one — same reason the backup workflow does (the
//      direct host is IPv6-only). Also read from .env.local if you would rather
//      keep it there; that file is gitignored.

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

// Catch a connection string that still carries a placeholder from whatever
// example it was copied out of. Without this the CLI fails with a bare
// `getaddrinfo ENOTFOUND` (for an unsubstituted host) or an auth error (for an
// unsubstituted password), and the hint below sends you looking at the wrong
// thing entirely — pooler-vs-direct, rather than "you left REGION in there".
// Hit for real on the first run.
if (dbUrl) {
  const placeholders = ['REGION', 'YOUR-PASSWORD', 'YOUR_PASSWORD', 'MOT_DE_PASSE', '[', ']'];
  const found = placeholders.filter((p) => dbUrl.includes(p));
  if (found.length > 0) {
    fail(
      `SUPABASE_DB_URL still contains a placeholder: ${found.join(', ')}`,
      'Copy the Session pooler string verbatim from the dashboard (Connect button) and replace only the password part — do not retype the host by hand.',
    );
  }
}

const args = dbUrl
  ? ['--yes', 'supabase@latest', 'gen', 'types', 'typescript', '--db-url', dbUrl]
  : ['--yes', 'supabase@latest', 'gen', 'types', 'typescript', '--project-id', projectRef];

console.log(
  dbUrl
    ? `Generating types for project ${projectRef} via its database connection…`
    : `Generating types for project ${projectRef} via the Management API (account login)…`,
);

// The CLI echoes the full --db-url into its own diagnostics, password included
// (it prints the `podman run --env PG_META_DB_URL=...` command line it is about
// to spawn). So its stderr is captured rather than inherited, and the password
// is masked before anything reaches the terminal — otherwise a routine failure
// leaks the credential into a scrollback buffer, a screenshot, or a pasted bug
// report. This happened for real before the masking existed.
function redact(text) {
  if (!text) return '';
  // postgresql://user:PASSWORD@host -> postgresql://user:***@host
  return text.replace(/(postgres(?:ql)?:\/\/[^:@\s]+:)[^@\s]+@/g, '$1***@');
}

let generated;
try {
  generated = execFileSync('npx', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: root,
  });
} catch (err) {
  // Both streams, deliberately: this CLI reports its failures on stdout (the
  // `podman run …` command line, the JSON auth error) and only some on stderr,
  // so inspecting one of them misses the diagnosis entirely.
  const output = redact(
    [err?.stdout?.toString?.() ?? '', err?.stderr?.toString?.() ?? ''].join('\n'),
  );
  if (output.trim()) console.error(output.trim());
  const stderr = output;

  // `--db-url` does not talk to Postgres directly: the CLI spawns a
  // containerised postgres-meta image (docker/podman). On a machine with no
  // container runtime that fails as `NotFound: ChildProcess.spawn (podman run
  // ...)`, which is easy to misread as a network or credential problem — it is
  // neither. `--project-id` goes through the Management API and needs no
  // container, so it is the route that works without installing anything.
  const needsContainer = /ChildProcess\.spawn|podman|docker/i.test(stderr);
  const hostUnresolved = /ENOTFOUND|getaddrinfo/i.test(stderr);
  const notAuthenticated = /access token|AuthRequired|supabase login/i.test(stderr);

  let hint;
  if (needsContainer) {
    hint =
      'The --db-url route spawns a containerised postgres-meta image and there is no container runtime here. Either install one (`brew install podman && podman machine init && podman machine start`), or drop SUPABASE_DB_URL and use `npx supabase login` instead — the --project-id route needs no container.';
  } else if (hostUnresolved) {
    hint =
      'The host could not be resolved. Copy the dashboard\'s Session pooler string verbatim (aws-0-<region>.pooler.supabase.com) — not the IPv6-only "Direct connection" one, and do not retype the host by hand.';
  } else if (notAuthenticated) {
    hint =
      'The CLI is not authenticated. Run `npx supabase login` (an account-wide token — `npx supabase logout` afterwards limits the window), or set SUPABASE_DB_URL if you have a container runtime available.';
  } else {
    hint = 'Rerun the CLI by hand with --debug to see more.';
  }
  fail('The Supabase CLI failed.', hint);
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
