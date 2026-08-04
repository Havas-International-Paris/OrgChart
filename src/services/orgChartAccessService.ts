import { supabase } from '../lib/supabaseClient';
import { assertRowsAffected } from '../lib/mutationGuard';
import type { OrgChartAccess, OrgChartAccessRole } from '../types/domain';

export async function fetchAccess(orgChartId: string): Promise<OrgChartAccess[]> {
  const { data, error } = await supabase
    .from('org_chart_access')
    .select('*')
    .eq('org_chart_id', orgChartId)
    .order('created_at');
  if (error) throw error;
  return data as OrgChartAccess[];
}

// Upsert: sharing with someone already granted access just changes their
// role instead of erroring on the (org_chart_id, user_id) primary key.
export async function grantAccess(
  orgChartId: string,
  userId: string,
  role: OrgChartAccessRole,
): Promise<void> {
  const { error } = await supabase
    .from('org_chart_access')
    .upsert({ org_chart_id: orgChartId, user_id: userId, role }, { onConflict: 'org_chart_id,user_id' });
  if (error) throw error;
}

export async function revokeAccess(orgChartId: string, userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('org_chart_access')
    .delete()
    .eq('org_chart_id', orgChartId)
    .eq('user_id', userId)
    .select();
  assertRowsAffected(data, error);
}

// Backed by the list_active_users() RPC (0017_org_chart_sharing.sql) —
// deliberately bypasses user_roles' own admin-gated SELECT policy so a
// non-admin chart owner can still pick who to share with. Returns only
// id+email for active accounts, never role/status.
export async function listActiveUsers(): Promise<{ user_id: string; email: string }[]> {
  const { data, error } = await supabase.rpc('list_active_users');
  if (error) throw error;
  return data ?? [];
}
