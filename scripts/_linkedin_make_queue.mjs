// Step 3: flatten the ranked shortlists into the flat (employee, candidate)
// work queue the browser driver walks, and emit it as compact JSON.
//
// Order matters: all of an employee's candidates sit together, best first, so
// the driver can skip the rest of a group the moment one confirms.
import { readFileSync, writeFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync('local-data/linkedin-photos/slug-ranked.json', 'utf8'));

// Compact on purpose: this array has to be pasted into a browser tool call as
// literal JS, so every byte is a token. Employee identity is the name itself —
// consecutive entries sharing a name are the same person's candidates.
const queue = [];
for (const r of rows) {
  const name = `${r.first_name} ${r.last_name}`;
  for (const c of r.shortlist) queue.push({ e: name, n: name, s: c.slug });
}

writeFileSync('local-data/linkedin-photos/queue.json', JSON.stringify(queue));
writeFileSync('local-data/linkedin-photos/queue-compact.json',
  JSON.stringify(queue.map((q) => [q.n, q.s])));
const noCand = rows.filter((r) => !r.shortlist.length).map((r) => `${r.first_name} ${r.last_name}`);
writeFileSync('local-data/linkedin-photos/no-candidate.json', JSON.stringify(noCand, null, 2));

console.log('queue tasks:', queue.length);
console.log('employees covered:', new Set(queue.map((q) => q.e)).size, '/', rows.length);
console.log('no candidate:', noCand.length);
console.log('bytes:', JSON.stringify(queue).length);
