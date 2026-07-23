import { supabase } from '../lib/supabaseClient';
import type { Employee, EmployeeInput, PhotoFrameValues } from '../types/domain';

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
  // A new photo always resets any previous crop — the old pan/zoom values
  // were framed for a different image and would misplace this one.
  const { data, error } = await supabase
    .from('employees')
    .update({ photo_path: photoPath, photo_zoom: 1, photo_pan_x: 0, photo_pan_y: 0 })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Employee;
}

export async function updateEmployeePhotoFrame(id: string, frame: PhotoFrameValues): Promise<Employee> {
  const { data, error } = await supabase
    .from('employees')
    .update({ photo_zoom: frame.zoom, photo_pan_x: frame.panX, photo_pan_y: frame.panY })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Employee;
}
