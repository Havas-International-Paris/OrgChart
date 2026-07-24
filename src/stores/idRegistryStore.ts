import { createIdBox, type IdBox } from '../lib/history/idBox';

// A plain module-level Map, not a zustand store — nothing here needs to
// trigger a re-render, it only needs to be read/written synchronously from
// inside command bodies (see idBox.ts for why the boxes themselves need to
// be looked up rather than closed-over as plain strings). Reset alongside
// historyStore.ts at every org-chart switch (see AppShell.tsx's
// switchOrgChart) so a box can never leak into an unrelated chart.
const registry = new Map<string, IdBox>();

// Every mutator wrapper resolves an incoming id through this instead of
// closing over the raw string, so a later command transparently follows an
// entity created earlier in the same undo/redo chain through its
// delete/recreate cycle — see idBox.ts. Falls back to a fresh one-off box for
// ids that predate any recorded history (they can never be the target of an
// in-chain create/recreate, so box semantics are moot for them, but every
// mutator wrapper still needs *a* box to close over uniformly).
export function boxFor(id: string): IdBox {
  const existing = registry.get(id);
  if (existing) return existing;
  const box = createIdBox(id);
  registry.set(id, box);
  return box;
}

// Called by any command that creates a brand-new entity, registering the box
// under its freshly-minted id so a *later*, independently-built command
// (e.g. a plain grid edit) can find it via boxFor() above.
export function registerIdBox(id: string, box: IdBox): void {
  registry.set(id, box);
}

export function resetIdRegistry(): void {
  registry.clear();
}
