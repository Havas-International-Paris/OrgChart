import { supabase } from '../lib/supabaseClient';
import type { Assignment } from '../types/domain';

export async function fetchAssignments(): Promise<Assignment[]> {
  const { data, error } = await supabase.from('assignments').select('*');
  if (error) throw error;
  return data as Assignment[];
}

export async function createAssignment(
  employeeId: string,
  clientMissionId: string,
  etpPercent: number,
): Promise<Assignment> {
  const { data, error } = await supabase
    .from('assignments')
    .insert({ employee_id: employeeId, client_mission_id: clientMissionId, etp_percent: etpPercent })
    .select()
    .single();
  if (error) throw error;
  return data as Assignment;
}

export async function updateAssignmentEtp(id: string, etpPercent: number): Promise<void> {
  const { error } = await supabase.from('assignments').update({ etp_percent: etpPercent }).eq('id', id);
  if (error) throw error;
}

export async function deleteAssignment(id: string): Promise<void> {
  const { error } = await supabase.from('assignments').delete().eq('id', id);
  if (error) throw error;
}
