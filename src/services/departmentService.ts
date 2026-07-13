import { supabase } from '../lib/supabaseClient';
import type { Department } from '../types/domain';

export async function fetchDepartments(): Promise<Department[]> {
  const { data, error } = await supabase.from('departments').select('*').order('created_at');
  if (error) throw error;
  return data as Department[];
}

export async function createDepartment(name: string): Promise<Department> {
  const { data, error } = await supabase.from('departments').insert({ name }).select().single();
  if (error) throw error;
  return data as Department;
}

export async function updateDepartment(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('departments').update({ name }).eq('id', id);
  if (error) throw error;
}

export async function deleteDepartment(id: string): Promise<void> {
  const { error } = await supabase.from('departments').delete().eq('id', id);
  if (error) throw error;
}
