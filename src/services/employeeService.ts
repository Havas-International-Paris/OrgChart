import { supabase } from '../lib/supabaseClient';
import type { Employee, EmployeeInput } from '../types/domain';

export async function fetchEmployees(orgChartId: string): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('org_chart_id', orgChartId)
    .order('last_name');
  if (error) throw error;
  return data as Employee[];
}

export async function createEmployee(orgChartId: string, input: EmployeeInput): Promise<Employee> {
  const { data, error } = await supabase
    .from('employees')
    .insert({ ...input, org_chart_id: orgChartId })
    .select()
    .single();
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

export async function updateEmployeePhoto(id: string, photoPath: string | null): Promise<Employee> {
  const { data, error } = await supabase
    .from('employees')
    .update({ photo_path: photoPath })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Employee;
}
