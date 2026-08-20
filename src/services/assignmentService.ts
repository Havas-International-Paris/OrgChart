import { supabase } from '../lib/supabaseClient';
import { assertRowsAffected } from '../lib/mutationGuard';
import type { Assignment, RemunerationModel } from '../types/domain';

export async function fetchAssignments(orgChartId: string): Promise<Assignment[]> {
  const { data, error } = await supabase.from('assignments').select('*').eq('org_chart_id', orgChartId);
  if (error) throw error;
  return data as Assignment[];
}

// Backlog item 58 Phase B — same reasoning as reportingService's own
// cross-chart fetch: a promotion candidate's assignments can live in any
// chart but the registry.
export async function fetchAssignmentsAcrossCharts(excludeChartId: string): Promise<Assignment[]> {
  const { data, error } = await supabase.from('assignments').select('*').neq('org_chart_id', excludeChartId);
  if (error) throw error;
  return data as Assignment[];
}

export async function createAssignment(
  orgChartId: string,
  employeeId: string,
  clientMissionId: string,
  etpVendu: number | null,
  etpReel: number | null,
  remunerationModel: RemunerationModel | null,
): Promise<Assignment> {
  const { data, error } = await supabase
    .from('assignments')
    .insert({
      employee_id: employeeId,
      client_mission_id: clientMissionId,
      etp_vendu: etpVendu,
      etp_reel: etpReel,
      remuneration_model: remunerationModel,
      org_chart_id: orgChartId,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Assignment;
}

export async function updateAssignmentEtpVendu(id: string, etpVendu: number | null): Promise<void> {
  const { data, error } = await supabase.from('assignments').update({ etp_vendu: etpVendu }).eq('id', id).select();
  assertRowsAffected(data, error);
}

export async function updateAssignmentEtpReel(id: string, etpReel: number | null): Promise<void> {
  const { data, error } = await supabase.from('assignments').update({ etp_reel: etpReel }).eq('id', id).select();
  assertRowsAffected(data, error);
}

// "% sold N+1" / "% expected N+1" (Time Estimation grid) — independent
// columns from the current year's etp_vendu, so both are always written
// together: the app enforces mutual exclusivity itself (setting one always
// zeroes the other in the same call) rather than a DB constraint, since a
// constraint would have to duplicate that same app-level bucketing rule to
// stay correct — see 0026_assignment_next_year_forecast.sql.
export async function updateAssignmentNextYear(
  id: string,
  etpVenduNextYear: number | null,
  etpExpectedNextYear: number | null,
): Promise<void> {
  const { data, error } = await supabase
    .from('assignments')
    .update({ etp_vendu_next_year: etpVenduNextYear, etp_expected_next_year: etpExpectedNextYear })
    .eq('id', id)
    .select();
  assertRowsAffected(data, error);
}

// clearVendu ensures a switch to 'commission' clears etp_vendu in the same
// write, since the DB check constraint rejects a commission row with a vendu
// value still set from a separate call.
export async function updateAssignmentRemuneration(
  id: string,
  remunerationModel: RemunerationModel | null,
  clearVendu: boolean,
): Promise<void> {
  const patch: { remuneration_model: RemunerationModel | null; etp_vendu?: null } = {
    remuneration_model: remunerationModel,
  };
  if (clearVendu) patch.etp_vendu = null;
  const { data, error } = await supabase.from('assignments').update(patch).eq('id', id).select();
  assertRowsAffected(data, error);
}

export async function deleteAssignment(id: string): Promise<void> {
  const { data, error } = await supabase.from('assignments').delete().eq('id', id).select();
  assertRowsAffected(data, error);
}

// Re-inserts under the ORIGINAL id — see employeeService.restoreEmployee.
export async function restoreAssignment(row: Assignment): Promise<Assignment> {
  const { data, error } = await supabase
    .from('assignments')
    .insert({
      id: row.id,
      employee_id: row.employee_id,
      client_mission_id: row.client_mission_id,
      etp_vendu: row.etp_vendu,
      etp_reel: row.etp_reel,
      remuneration_model: row.remuneration_model,
      org_chart_id: row.org_chart_id,
      etp_vendu_next_year: row.etp_vendu_next_year,
      etp_expected_next_year: row.etp_expected_next_year,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Assignment;
}
