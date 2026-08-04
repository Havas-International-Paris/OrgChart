import { supabase } from '../lib/supabaseClient';
import type { OrgChart } from '../types/domain';

// Excludes the registry chart (backlog item 58) — every existing consumer
// (the chart selector, the duplicate-source picker) should never see or
// offer it; it's reached only via fetchRegistryOrgChart below.
export async function fetchOrgCharts(): Promise<OrgChart[]> {
  const { data, error } = await supabase
    .from('org_charts')
    .select('*')
    .eq('is_registry', false)
    .order('created_at');
  if (error) throw error;
  return data as OrgChart[];
}

export async function fetchRegistryOrgChart(): Promise<OrgChart | null> {
  const { data, error } = await supabase.from('org_charts').select('*').eq('is_registry', true).maybeSingle();
  if (error) throw error;
  return data as OrgChart | null;
}

export async function createOrgChart(name: string, shortLabel: string): Promise<OrgChart> {
  const { data, error } = await supabase
    .from('org_charts')
    .insert({ name, short_label: shortLabel })
    .select()
    .single();
  if (error) throw error;
  return data as OrgChart;
}

export async function updateOrgChart(
  id: string,
  changes: Partial<Pick<OrgChart, 'name' | 'short_label'>>,
): Promise<void> {
  const { error } = await supabase.from('org_charts').update(changes).eq('id', id);
  if (error) throw error;
}

export async function duplicateOrgChart(
  sourceId: string,
  newName: string,
  newShortLabel: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('duplicate_org_chart', {
    source_id: sourceId,
    new_name: newName,
    new_short_label: newShortLabel,
  });
  if (error) throw error;
  return data as string;
}

// Chains .select() specifically so a delete blocked by RLS (an account whose
// role isn't editeur/admin, or one still pending — see 0015_user_roles.sql)
// is DETECTABLE: Postgres' DELETE ... USING policy just matches zero rows
// when it denies the operation, which supabase-js reports as a normal
// success with an empty array, not an error. Without .select(), the caller
// has no way to tell "deleted" from "silently refused" apart — this was hit
// for real: the button visibly did nothing, no error anywhere.
export async function deleteOrgChart(id: string): Promise<void> {
  const { data, error } = await supabase.from('org_charts').delete().eq('id', id).select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('DELETE_NOT_PERMITTED');
  }
}
