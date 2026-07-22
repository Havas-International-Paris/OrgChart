import { supabase } from '../lib/supabaseClient';
import type { OrgChart } from '../types/domain';

export async function fetchOrgCharts(): Promise<OrgChart[]> {
  const { data, error } = await supabase.from('org_charts').select('*').order('created_at');
  if (error) throw error;
  return data as OrgChart[];
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

export async function deleteOrgChart(id: string): Promise<void> {
  const { error } = await supabase.from('org_charts').delete().eq('id', id);
  if (error) throw error;
}
