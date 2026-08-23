-- Marks an (employee, client_mission) pairing that an admin added by hand
-- from the "Estimation des temps" grid — e.g. an employee who just joined a
-- team and starts working on an account they had no prior row for.
-- Existence of a row here IS the "manually added" flag: TimeEstimationGrid.
-- tsx's baseLineItems treats this as a 5th row source (alongside
-- assignments, time_actuals, time_actual_n1_totals, time_forecast_months),
-- and the grid's "Origine" column shows a badge only when a row exists here.
--
-- No `year` column, unlike time_actual_n1_totals/time_manual_edit_markers —
-- this marks the PAIRING itself, which persists across N-1/N/N+1, not a
-- fact about one particular year.
--
-- Deletion is a real row delete (identity-stable undo — capture the row,
-- restore it under its original id on redo, matching time_actual_groups's
-- createGroup/deleteGroup). Deleting this row never cascades into
-- assignments/time_actuals/time_forecast_months/time_actual_n1_totals —
-- those are separate tables the admin may since have filled in, and
-- removing the "manual" marker must not discard real data entered
-- afterward.
create table public.time_manual_rows (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees(id) on delete cascade,
  client_mission_id  uuid not null references public.clients_missions(id) on delete cascade,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id) on delete set null,
  unique (employee_id, client_mission_id)
);

alter table public.time_manual_rows enable row level security;

create policy "admin_select_time_manual_rows" on public.time_manual_rows
  for select using (public.is_active_admin());
create policy "admin_insert_time_manual_rows" on public.time_manual_rows
  for insert with check (public.is_active_admin());
create policy "admin_update_time_manual_rows" on public.time_manual_rows
  for update using (public.is_active_admin()) with check (public.is_active_admin());
create policy "admin_delete_time_manual_rows" on public.time_manual_rows
  for delete using (public.is_active_admin());

alter publication supabase_realtime add table public.time_manual_rows;
