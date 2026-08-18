import { supabase } from '../lib/supabaseClient';
import { assertRowsAffected } from '../lib/mutationGuard';
import type { UserRole, UserRoleName } from '../types/domain';

export async function fetchAllUserRoles(): Promise<UserRole[]> {
  const { data, error } = await supabase.from('user_roles').select('*').order('created_at');
  if (error) throw error;
  return data as UserRole[];
}

// A pending/active user's own row — RLS lets everyone read this regardless
// of role, unlike fetchAllUserRoles (admin-only in practice, since RLS only
// returns every row for an active admin).
export async function fetchOwnUserRole(userId: string): Promise<UserRole | null> {
  const { data, error } = await supabase.from('user_roles').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data as UserRole | null;
}

export async function approveUser(userId: string, role: UserRoleName): Promise<void> {
  const { data, error } = await supabase
    .from('user_roles')
    .update({ role, status: 'active' })
    .eq('user_id', userId)
    .select();
  assertRowsAffected(data, error);
}

export async function changeUserRole(userId: string, role: UserRoleName): Promise<void> {
  const { data, error } = await supabase.from('user_roles').update({ role }).eq('user_id', userId).select();
  assertRowsAffected(data, error);
}

// Marks the row status='refused' rather than deleting it (0025 added the
// 'refused' value to the check constraint). Keeping the row in place means
// a re-signup with the same email stays banned: the on_auth_user_created
// trigger's on-conflict-do-nothing leaves the refused row alone, so
// is_active_user() keeps returning false for that email forever. An admin
// can re-approve via approveUser() if the decision is ever reversed.
export async function refuseUser(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('user_roles')
    .update({ status: 'refused' })
    .eq('user_id', userId)
    .select();
  assertRowsAffected(data, error);
}
