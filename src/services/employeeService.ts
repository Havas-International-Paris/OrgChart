import { supabase } from '../lib/supabaseClient';
import type { Employee, EmployeeInput } from '../types/domain';

export async function fetchEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase.from('employees').select('*').order('last_name');
  if (error) throw error;
  return data as Employee[];
}

export async function createEmployee(input: EmployeeInput): Promise<Employee> {
  const { data, error } = await supabase.from('employees').insert(input).select().single();
  if (error) throw error;
  return data as Employee;
}

export async function updateEmployee(id: string, changes: Partial<EmployeeInput>): Promise<Employee> {
  const { data, error } = await supabase
    .from('employees')
    .update(changes)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Employee;
}

export async function deleteEmployee(id: string): Promise<void> {
  const { error } = await supabase.from('employees').delete().eq('id', id);
  if (error) throw error;
}
