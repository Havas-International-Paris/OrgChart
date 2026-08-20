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

// Direct, uncached read of one (employee, client) pair's row — used by
// TimeEstimationGrid's vendu/prevu handlers to decide their
// remuneration_model flip from the FRESHEST server state right before
// writing, rather than from a component-render snapshot that can be stale
// by the time a second, rapidly-fired edit (e.g. Tab from % sold to %
// expected) runs — see the grid's own withRowLock for the full race.
export async function fetchAssignmentByPair(
  orgChartId: string,
  employeeId: string,
  clientMissionId: string,
): Promise<Assignment | null> {
  const { data, error } = await supabase
    .from('assignments')
    .select('*')
    .eq('org_chart_id', orgChartId)
    .eq('employee_id', employeeId)
    .eq('client_mission_id', clientMissionId)
    .maybeSingle();
  if (error) throw error;
  return data as Assignment | null;
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

// TimeEstimationGrid's vendu/prevu handlers use this instead of two
// sequential updateAssignmentEtpVendu + updateAssignmentRemuneration calls —
// splitting them left a real, observable window where the row briefly held
// an inconsistent (value, model) pair, and doubled the number of Postgres
// change events (hence realtime-triggered refetches) per edit, which turned
// out to be the actual cause of a persistent display flicker reported live.
// One atomic write removes both problems.
export async function updateAssignmentVenduAndModel(
  id: string,
  etpVendu: number | null,
  remunerationModel: RemunerationModel | null,
): Promise<void> {
  const { data, error } = await supabase
    .from('assignments')
    .update({ etp_vendu: etpVendu, remuneration_model: remunerationModel })
    .eq('id', id)
    .select();
  assertRowsAffected(data, error);
}

// Same reasoning as updateAssignmentVenduAndModel, for the N+1 pair.
export async function updateAssignmentVenduAndModelNextYear(
  id: string,
  etpVenduNextYear: number | null,
  remunerationModelNextYear: RemunerationModel | null,
): Promise<void> {
  const { data, error } = await supabase
    .from('assignments')
    .update({ etp_vendu_next_year: etpVenduNextYear, remuneration_model_next_year: remunerationModelNextYear })
    .eq('id', id)
    .select();
  assertRowsAffected(data, error);
}

export async function updateAssignmentEtpReel(id: string, etpReel: number | null): Promise<void> {
  const { data, error } = await supabase.from('assignments').update({ etp_reel: etpReel }).eq('id', id).select();
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
      remuneration_model_next_year: row.remuneration_model_next_year,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Assignment;
}
