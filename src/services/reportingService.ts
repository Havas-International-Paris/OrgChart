import { supabase } from '../lib/supabaseClient';
import type { ReportingRelationship } from '../types/domain';

export async function fetchReportingRelationships(): Promise<ReportingRelationship[]> {
  const { data, error } = await supabase.from('reporting_relationships').select('*');
  if (error) throw error;
  return data as ReportingRelationship[];
}

export async function createRelationship(
  employeeId: string,
  managerId: string,
  isPrimary: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('reporting_relationships')
    .insert({ employee_id: employeeId, manager_id: managerId, is_primary: isPrimary });
  if (error) throw error;
}

export async function updateRelationshipPrimary(id: string, isPrimary: boolean): Promise<void> {
  const { error } = await supabase
    .from('reporting_relationships')
    .update({ is_primary: isPrimary })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteRelationship(id: string): Promise<void> {
  const { error } = await supabase.from('reporting_relationships').delete().eq('id', id);
  if (error) throw error;
}
