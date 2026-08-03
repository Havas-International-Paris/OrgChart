import { supabase } from '../lib/supabaseClient';
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
  const { error } = await supabase.from('user_roles').update({ role, status: 'active' }).eq('user_id', userId);
  if (error) throw error;
}

export async function changeUserRole(userId: string, role: UserRoleName): Promise<void> {
  const { error } = await supabase.from('user_roles').update({ role }).eq('user_id', userId);
  if (error) throw error;
}

// Deletes the pending row rather than setting some "rejected" status — a
// refused signup simply never gets a user_roles row again, so is_active_user()
// stays false for them permanently (same as CLAUDE.md's spec: no role/table
// mutation possible from the client without one).
export async function refuseUser(userId: string): Promise<void> {
  const { error } = await supabase.from('user_roles').delete().eq('user_id', userId);
  if (error) throw error;
}
