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

// Drag-to-reorder support (siblingOrder.ts) — a single reorder gesture may
// need to backfill several siblings' sibling_order in one go (see
// useEmployees.ts's updateSiblingOrders), hence the batch shape rather than
// one id/value pair at a time.
export async function updateSiblingOrders(
  updates: { id: string; siblingOrder: number | null }[],
): Promise<void> {
  const results = await Promise.all(
    updates.map(({ id, siblingOrder }) =>
      supabase.from('employees').update({ sibling_order: siblingOrder }).eq('id', id),
    ),
  );
  const firstError = results.find((r) => r.error)?.error;
  if (firstError) throw firstError;
}

// Re-inserts a previously-deleted row under its ORIGINAL id, rather than letting
// Postgres mint a new one. This is what makes undo/redo identity-stable and is
// why idBox/idRegistryStore no longer exist: a command recorded at t0 can close
// over a plain string id, because that id survives a delete/restore cycle.
//
// Restores the whole row, not just the editable fields, so a photo and its crop
// (and any manual sibling_order) come back too — createEmployee only takes
// EmployeeInput, which is why undoing a delete used to silently drop them.
// created_at/updated_at/created_by/updated_by are deliberately omitted: the
// set_updated_at / set_audit_fields triggers own those.
export async function restoreEmployee(row: Employee): Promise<Employee> {
  const { data, error } = await supabase
    .from('employees')
    .insert({
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      job_title: row.job_title,
      role_desc: row.role_desc,
      department: row.department,
      photo_path: row.photo_path,
      photo_zoom: row.photo_zoom,
      photo_pan_x: row.photo_pan_x,
      photo_pan_y: row.photo_pan_y,
      sibling_order: row.sibling_order,
      org_chart_id: row.org_chart_id,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Employee;
}
