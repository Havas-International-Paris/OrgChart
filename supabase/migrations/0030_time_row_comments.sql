-- A free-text note attached to a single (employee, client/mission) row in
-- the "Estimation des temps" grid — surfaced as a small flag icon next to
-- RowOriginMarker's "i"/"a" letter in TimeEstimationGrid.tsx (grey when no
-- row exists here, red when one does). No `year` column: like
-- time_manual_rows, the comment belongs to the pair itself, not a specific
-- N-1/N/N+1 period. unique(employee_id, client_mission_id) makes create
-- and edit the exact same upsert call — the popover's Save button always
-- calls upsertTimeRowComment regardless of whether a comment already
-- existed.
create table public.time_row_comments (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees(id) on delete cascade,
  client_mission_id  uuid not null references public.clients_missions(id) on delete cascade,
  comment_text       text not null check (btrim(comment_text) <> ''),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id) on delete set null,
  unique (employee_id, client_mission_id)
);

alter table public.time_row_comments enable row level security;

create policy "admin_select_time_row_comments" on public.time_row_comments
  for select using (public.is_active_admin());
create policy "admin_insert_time_row_comments" on public.time_row_comments
  for insert with check (public.is_active_admin());
create policy "admin_update_time_row_comments" on public.time_row_comments
  for update using (public.is_active_admin()) with check (public.is_active_admin());
create policy "admin_delete_time_row_comments" on public.time_row_comments
  for delete using (public.is_active_admin());

alter publication supabase_realtime add table public.time_row_comments;
