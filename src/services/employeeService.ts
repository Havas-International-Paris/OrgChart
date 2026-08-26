import { supabase } from '../lib/supabaseClient';
import { assertRowsAffected } from '../lib/mutationGuard';
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

// Backlog item 58 Phase B ("Salariés à promouvoir") — the one genuinely
// cross-chart query in this app; every other fetch* here is scoped to a
// single org_chart_id. Deliberately plain (`.neq`, no embedded relationship
// select) to match this codebase's existing "join client-side in memory"
// convention (see CLAUDE.md) rather than introducing Supabase's embedded-
// select syntax nowhere else in the app uses — usePromotionCandidates.ts
// joins the org chart's own name in afterward.
export async function fetchCandidateEmployees(registryChartId: string, includeHidden: boolean): Promise<Employee[]> {
  let query = supabase.from('employees').select('*').neq('org_chart_id', registryChartId);
  if (!includeHidden) query = query.eq('hidden_from_registry_candidates', false);
  const { data, error } = await query.order('last_name');
  if (error) throw error;
  return data as Employee[];
}

export async function setHiddenFromRegistryCandidates(id: string, hidden: boolean): Promise<void> {
  const { data, error } = await supabase
    .from('employees')
    .update({ hidden_from_registry_candidates: hidden })
    .eq('id', id)
    .select();
  assertRowsAffected(data, error);
}

export async function setHasLeftCompany(id: string, hasLeft: boolean): Promise<void> {
  const { data, error } = await supabase
    .from('employees')
    .update({ has_left_company: hasLeft })
    .eq('id', id)
    .select();
  assertRowsAffected(data, error);
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
  const { data, error } = await supabase.from('employees').update(changes).eq('id', id).select();
  assertRowsAffected(data, error);
  return data[0] as Employee;
}

export async function deleteEmployee(id: string): Promise<void> {
  const { data, error } = await supabase.from('employees').delete().eq('id', id).select();
  assertRowsAffected(data, error);
}

export async function updateEmployeePhoto(id: string, photoPath: string | null): Promise<Employee> {
  // A new photo always resets any previous crop — the old pan/zoom values
  // were framed for a different image and would misplace this one.
  const { data, error } = await supabase
    .from('employees')
    .update({ photo_path: photoPath, photo_zoom: 1, photo_pan_x: 0, photo_pan_y: 0 })
    .eq('id', id)
    .select();
  assertRowsAffected(data, error);
  return data[0] as Employee;
}

export async function updateEmployeePhotoFrame(id: string, frame: PhotoFrameValues): Promise<Employee> {
  const { data, error } = await supabase
    .from('employees')
    .update({ photo_zoom: frame.zoom, photo_pan_x: frame.panX, photo_pan_y: frame.panY })
    .eq('id', id)
    .select();
  assertRowsAffected(data, error);
  return data[0] as Employee;
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
      supabase.from('employees').update({ sibling_order: siblingOrder }).eq('id', id).select(),
    ),
  );
  for (const r of results) assertRowsAffected(r.data, r.error);
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
// set_updated_at / set_audit_fields triggers own those. hidden_from_registry_
// candidates and has_left_company are both included so undoing a delete
// restores them too, not silently resets them to their DB default — a real
// gap the first of the two had until has_left_company's own addition caught it.
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
      company: row.company,
      photo_path: row.photo_path,
      photo_zoom: row.photo_zoom,
      photo_pan_x: row.photo_pan_x,
      photo_pan_y: row.photo_pan_y,
      sibling_order: row.sibling_order,
      org_chart_id: row.org_chart_id,
      hidden_from_registry_candidates: row.hidden_from_registry_candidates,
      has_left_company: row.has_left_company,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Employee;
}

// Backlog item 58 — a NEW row (fresh id, via a separate insert from
// restoreEmployee above, never the source's own id) in a DIFFERENT chart,
// copying the source employee's name/poste/BU/photo fields. Deliberately
// excludes sibling_order (the spec says never copy it — the target chart's
// own layout should decide it) and doesn't take EmployeeInput, which
// deliberately excludes photo fields from the plain create/edit form; this
// is a distinct, special-purpose insert, same reasoning as restoreEmployee's
// own dedicated shape. Generic over direction — used both by flux 1 (Phase A,
// registry → a working chart, via useRegistryImport.ts) and flux 2 (Phase B,
// a working chart → the registry, via usePromotionCandidates.ts): both are
// "copy this employee's core fields into a different chart," just with the
// source/target swapped. has_left_company is deliberately excluded too, same
// reasoning as sibling_order above: someone promoted/imported into a
// different chart starts fresh there, not carrying over a departure status
// recorded in a different chart's context.
export async function importEmployee(targetOrgChartId: string, source: Employee): Promise<Employee> {
  const { data, error } = await supabase
    .from('employees')
    .insert({
      first_name: source.first_name,
      last_name: source.last_name,
      job_title: source.job_title,
      role_desc: source.role_desc,
      department: source.department,
      company: source.company,
      photo_path: source.photo_path,
      photo_zoom: source.photo_zoom,
      photo_pan_x: source.photo_pan_x,
      photo_pan_y: source.photo_pan_y,
      org_chart_id: targetOrgChartId,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Employee;
}
