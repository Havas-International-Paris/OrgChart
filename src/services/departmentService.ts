import { supabase } from '../lib/supabaseClient';
import { assertRowsAffected } from '../lib/mutationGuard';
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
  const { data, error } = await supabase.from('departments').update({ name }).eq('id', id).select();
  assertRowsAffected(data, error);
}

export async function updateDepartmentColor(id: string, color: string | null): Promise<void> {
  const { data, error } = await supabase.from('departments').update({ color }).eq('id', id).select();
  assertRowsAffected(data, error);
}

export async function deleteDepartment(id: string): Promise<void> {
  const { data, error } = await supabase.from('departments').delete().eq('id', id).select();
  assertRowsAffected(data, error);
}

// Re-inserts under the ORIGINAL id — see employeeService.restoreEmployee.
export async function restoreDepartment(row: Department): Promise<Department> {
  const { data, error } = await supabase
    .from('departments')
    .insert({ id: row.id, name: row.name, color: row.color })
    .select()
    .single();
  if (error) throw error;
  return data as Department;
}
