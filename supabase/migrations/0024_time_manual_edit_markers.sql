-- Marks which single cell in the "Estimation des temps" grid the user
-- directly typed a value into (as opposed to a cell that changed only as a
-- mechanical side effect of that edit — a recomputed average/total, or a
-- month a cascade fill also touched). Only the DIRECT edit is stored here;
-- the "derived" (lighter) highlight is recomputed at render time from which
-- other fields fall in the same range as a direct marker — see
-- TimeEstimationGrid.tsx. Deliberately excludes vendu/prevu (assignments.
-- etp_vendu), which already have their own permanent pink treatment for a
-- different reason (an import never writes there at all, not "you just
-- edited this").
--
-- One row per directly-edited field, cleared automatically by
-- ImportTimeActualsWizard.tsx whenever a re-import overwrites that exact
-- field's data — a re-import always wins outright, so a stale marker must
-- not keep implying "this is a manual value" once it no longer is one.
create table public.time_manual_edit_markers (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees(id) on delete cascade,
  client_mission_id  uuid not null references public.clients_missions(id) on delete cascade,
  year               int not null,
  field              text not null, -- 'n1Total' | 'total' | 'avgPast' | 'avgRemaining' | 'm0'..'m11'
  edited_at          timestamptz not null default now(),
  unique (employee_id, client_mission_id, year, field)
);

alter table public.time_manual_edit_markers enable row level security;

create policy "admin_select_time_manual_edit_markers" on public.time_manual_edit_markers
  for select using (public.is_active_admin());
create policy "admin_insert_time_manual_edit_markers" on public.time_manual_edit_markers
  for insert with check (public.is_active_admin());
create policy "admin_update_time_manual_edit_markers" on public.time_manual_edit_markers
  for update using (public.is_active_admin()) with check (public.is_active_admin());
create policy "admin_delete_time_manual_edit_markers" on public.time_manual_edit_markers
  for delete using (public.is_active_admin());

alter publication supabase_realtime add table public.time_manual_edit_markers;
