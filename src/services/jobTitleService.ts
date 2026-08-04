import { supabase } from '../lib/supabaseClient';
import { assertRowsAffected } from '../lib/mutationGuard';
import type { JobTitle } from '../types/domain';

export async function fetchJobTitles(): Promise<JobTitle[]> {
  const { data, error } = await supabase.from('job_titles').select('*').order('name');
  if (error) throw error;
  return data as JobTitle[];
}

export async function createJobTitle(name: string): Promise<JobTitle> {
  const { data, error } = await supabase.from('job_titles').insert({ name }).select().single();
  if (error) throw error;
  return data as JobTitle;
}

export async function updateJobTitle(id: string, name: string): Promise<void> {
  const { data, error } = await supabase.from('job_titles').update({ name }).eq('id', id).select();
  assertRowsAffected(data, error);
}

export async function deleteJobTitle(id: string): Promise<void> {
  const { data, error } = await supabase.from('job_titles').delete().eq('id', id).select();
  assertRowsAffected(data, error);
}

// Re-inserts under the ORIGINAL id — see employeeService.restoreEmployee.
export async function restoreJobTitle(row: JobTitle): Promise<JobTitle> {
  const { data, error } = await supabase
    .from('job_titles')
    .insert({ id: row.id, name: row.name })
    .select()
    .single();
  if (error) throw error;
  return data as JobTitle;
}
