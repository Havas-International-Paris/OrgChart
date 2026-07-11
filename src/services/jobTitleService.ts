import { supabase } from '../lib/supabaseClient';
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
  const { error } = await supabase.from('job_titles').update({ name }).eq('id', id);
  if (error) throw error;
}

export async function deleteJobTitle(id: string): Promise<void> {
  const { error } = await supabase.from('job_titles').delete().eq('id', id);
  if (error) throw error;
}
