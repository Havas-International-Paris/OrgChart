// Solves "redo after create": createEmployee (and other create mutators)
// return a fresh id from Supabase each time they run, so a command built at
// t0 referencing "the entity created at t0" can't just close over a plain
// string id — a later redo of that same create will mint a DIFFERENT id.
//
// Instead, every command that needs to reference a created entity closes
// over its IdBox and reads `.id` at call time. Whenever that entity is
// deleted/recreated, its box is mutated IN PLACE (`box.id = newId`) — never
// replaced with a new object — so every other command sharing a reference to
// the same box transparently follows the entity through its lifecycle.
//
// See idRegistryStore.ts for how a command built far from the original
// create (e.g. a later, unrelated grid edit) finds the right box to close
// over instead of a raw id.
export interface IdBox {
  id: string;
}

export function createIdBox(id: string): IdBox {
  return { id };
}
