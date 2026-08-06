import { supabase } from './supabaseClient';

// Backlog item 54 — simultaneous-edit warning. Compares the row's
// `updated_at` as the client last knew it (from its own local state, kept
// in sync by refresh()/realtime) against the server's actual current value
// right before writing. A mismatch means someone else's write landed in
// the gap since this client's last sync — genuinely possible even with
// realtime, since the window between "another user's write commits" and
// "this client's subscription callback finishes its own refetch" is real,
// just usually small.
//
// Deliberately warn-only, never blocking: this app has no optimistic
// locking (see CLAUDE.md's "Known issues" — that's a bigger, separate
// piece, item 37) and this doesn't add any. The write this guards still
// proceeds unconditionally and still wins (last-write-wins, as always) —
// the point is only to tell the user it happened, not to prevent it or
// attempt a merge.
export async function hasConcurrentUpdate(
  table: 'employees',
  id: string,
  knownUpdatedAt: string | null | undefined,
): Promise<boolean> {
  if (!knownUpdatedAt) return false;
  const { data } = await supabase.from(table).select('updated_at').eq('id', id).maybeSingle();
  if (!data) return false;
  return data.updated_at !== knownUpdatedAt;
}
