import { supabase } from '../lib/supabaseClient';
import type { Assignment, RemunerationModel } from '../types/domain';

export async function fetchAssignments(orgChartId: string): Promise<Assignment[]> {
  const { data, error } = await supabase.from('assignments').select('*').eq('org_chart_id', orgChartId);
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
  const { error } = await supabase.from('assignments').update({ etp_vendu: etpVendu }).eq('id', id);
  if (error) throw error;
}

export async function updateAssignmentEtpReel(id: string, etpReel: number | null): Promise<void> {
  const { error } = await supabase.from('assignments').update({ etp_reel: etpReel }).eq('id', id);
  if (error) throw error;
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
  const { error } = await supabase.from('assignments').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteAssignment(id: string): Promise<void> {
  const { error } = await supabase.from('assignments').delete().eq('id', id);
  if (error) throw error;
}
