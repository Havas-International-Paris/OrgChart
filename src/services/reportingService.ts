import { supabase } from '../lib/supabaseClient';
import { assertRowsAffected } from '../lib/mutationGuard';
import type { ReportingRelationship } from '../types/domain';

export async function fetchReportingRelationships(orgChartId: string): Promise<ReportingRelationship[]> {
  const { data, error } = await supabase
    .from('reporting_relationships')
    .select('*')
    .eq('org_chart_id', orgChartId);
  if (error) throw error;
  return data as ReportingRelationship[];
}

// Backlog item 58 Phase B — resolving a promotion candidate's manager needs
// every OTHER chart's relationships (the candidate can come from any of
// them), not just one. Same "load everything, filter in memory" convention
// as employeeService.fetchCandidateEmployees.
export async function fetchRelationshipsAcrossCharts(excludeChartId: string): Promise<ReportingRelationship[]> {
  const { data, error } = await supabase.from('reporting_relationships').select('*').neq('org_chart_id', excludeChartId);
  if (error) throw error;
  return data as ReportingRelationship[];
}

export async function createRelationship(
  orgChartId: string,
  employeeId: string,
  managerId: string,
  isPrimary: boolean,
): Promise<ReportingRelationship> {
  const { data, error } = await supabase
    .from('reporting_relationships')
    .insert({
      employee_id: employeeId,
      manager_id: managerId,
      is_primary: isPrimary,
      org_chart_id: orgChartId,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ReportingRelationship;
}

export async function updateRelationshipPrimary(id: string, isPrimary: boolean): Promise<void> {
  const { data, error } = await supabase
    .from('reporting_relationships')
    .update({ is_primary: isPrimary })
    .eq('id', id)
    .select();
  assertRowsAffected(data, error);
}

export async function updateRelationshipManager(id: string, newManagerId: string): Promise<void> {
  const { data, error } = await supabase
    .from('reporting_relationships')
    .update({ manager_id: newManagerId })
    .eq('id', id)
    .select();
  assertRowsAffected(data, error);
}

export async function deleteRelationship(id: string): Promise<void> {
  const { data, error } = await supabase.from('reporting_relationships').delete().eq('id', id).select();
  assertRowsAffected(data, error);
}

// Re-inserts under the ORIGINAL id — see employeeService.restoreEmployee for why
// every restore path must preserve identity rather than mint a new id.
export async function restoreRelationship(row: ReportingRelationship): Promise<ReportingRelationship> {
  const { data, error } = await supabase
    .from('reporting_relationships')
    .insert({
      id: row.id,
      employee_id: row.employee_id,
      manager_id: row.manager_id,
      is_primary: row.is_primary,
      org_chart_id: row.org_chart_id,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ReportingRelationship;
}
