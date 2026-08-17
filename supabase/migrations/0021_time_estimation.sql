-- Module "Estimation des temps" (admin-only) — backlog item: time forecasting
-- per registry employee x client_mission. All tables here are global (no
-- org_chart_id), same shape as clients_missions, but scoped in practice to
-- the registry org chart: employee_id/resolved_employee_id are expected to
-- point at an employee row that lives in the registry chart. That can't be
-- expressed as a DB check constraint (would need a subquery into
-- org_charts/employees, not allowed in a CHECK), so it's enforced
-- application-side at write time — see src/services/timeEstimationService.ts.
--
-- RLS deliberately requires an active ADMIN for SELECT too, not just writes
-- — a deviation from every other table's "any active user can read" policy
-- (active_select_<table> using is_active_user()). Time/margin forecasting
-- data is judged more sensitive than org-structure data.

create table public.time_import_batches (
  id          uuid primary key default gen_random_uuid(),
  year        int not null,
  filename    text not null,
  row_count   int not null,
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id) on delete set null
);

create table public.time_actuals (
  id                        uuid primary key default gen_random_uuid(),
  batch_id                  uuid references public.time_import_batches(id) on delete set null,
  year                      int not null,
  month                     int not null check (month between 1 and 12),
  raw_employee_name         text not null,
  raw_client_name           text not null,
  raw_sous_dossier          text,
  raw_group_annonceur       text,
  raw_payroll_name          text,
  raw_bu_name               text,
  etp_pct                   numeric not null,
  resolved_employee_id      uuid references public.employees(id) on delete set null,
  resolved_client_mission_id uuid references public.clients_missions(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (raw_employee_name, raw_client_name, year, month)
);

create trigger trg_time_actuals_updated_at before update on public.time_actuals
  for each row execute function public.set_updated_at();

-- Alias memory: once an admin manually resolves a raw name during import
-- review, later imports skip the review screen for that exact raw text.
-- employee_id/client_mission_id nullable = "ignore this name forever" (e.g.
-- an external contractor never tracked in the registry).
create table public.time_employee_aliases (
  id          uuid primary key default gen_random_uuid(),
  raw_name    text not null unique,
  employee_id uuid references public.employees(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.time_client_aliases (
  id                 uuid primary key default gen_random_uuid(),
  raw_name           text not null unique,
  client_mission_id  uuid references public.clients_missions(id) on delete cascade,
  created_at         timestamptz not null default now()
);

-- The only hand-entered data in this module: planned_pct (% for the
-- remaining months of the year, one value, no monthly breakdown) and
-- total_pct, a STORED (not purely computed) prorated actual+planned total —
-- stored because it's meant to be reused outside this module later, kept in
-- sync by the app on every write that affects it (planned edit, new actual
-- import, group change), not by a DB trigger.
create table public.time_forecasts (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees(id) on delete cascade,
  client_mission_id  uuid not null references public.clients_missions(id) on delete cascade,
  year               int not null,
  planned_pct        numeric,
  total_pct          numeric,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (employee_id, client_mission_id, year)
);

create trigger trg_time_forecasts_updated_at before update on public.time_forecasts
  for each row execute function public.set_updated_at();

-- "Drag a non-sold employee's row onto a sold employee's row" grouping,
-- scoped per client_mission (the same person can be a member under one
-- reference employee on client A and have their own sold/prevu line on
-- client B). A member can only ever roll up under ONE primary per client.
create table public.time_actual_groups (
  id                  uuid primary key default gen_random_uuid(),
  client_mission_id   uuid not null references public.clients_missions(id) on delete cascade,
  primary_employee_id uuid not null references public.employees(id) on delete cascade,
  member_employee_id  uuid not null references public.employees(id) on delete cascade,
  created_at          timestamptz not null default now(),
  unique (client_mission_id, member_employee_id),
  check (primary_employee_id <> member_employee_id)
);

alter table public.time_import_batches enable row level security;
alter table public.time_actuals enable row level security;
alter table public.time_employee_aliases enable row level security;
alter table public.time_client_aliases enable row level security;
alter table public.time_forecasts enable row level security;
alter table public.time_actual_groups enable row level security;

create policy "admin_select_time_import_batches" on public.time_import_batches
  for select using (public.is_active_admin());
create policy "admin_insert_time_import_batches" on public.time_import_batches
  for insert with check (public.is_active_admin());
create policy "admin_update_time_import_batches" on public.time_import_batches
  for update using (public.is_active_admin()) with check (public.is_active_admin());
create policy "admin_delete_time_import_batches" on public.time_import_batches
  for delete using (public.is_active_admin());

create policy "admin_select_time_actuals" on public.time_actuals
  for select using (public.is_active_admin());
create policy "admin_insert_time_actuals" on public.time_actuals
  for insert with check (public.is_active_admin());
create policy "admin_update_time_actuals" on public.time_actuals
  for update using (public.is_active_admin()) with check (public.is_active_admin());
create policy "admin_delete_time_actuals" on public.time_actuals
  for delete using (public.is_active_admin());

create policy "admin_select_time_employee_aliases" on public.time_employee_aliases
  for select using (public.is_active_admin());
create policy "admin_insert_time_employee_aliases" on public.time_employee_aliases
  for insert with check (public.is_active_admin());
create policy "admin_update_time_employee_aliases" on public.time_employee_aliases
  for update using (public.is_active_admin()) with check (public.is_active_admin());
create policy "admin_delete_time_employee_aliases" on public.time_employee_aliases
  for delete using (public.is_active_admin());

create policy "admin_select_time_client_aliases" on public.time_client_aliases
  for select using (public.is_active_admin());
create policy "admin_insert_time_client_aliases" on public.time_client_aliases
  for insert with check (public.is_active_admin());
create policy "admin_update_time_client_aliases" on public.time_client_aliases
  for update using (public.is_active_admin()) with check (public.is_active_admin());
create policy "admin_delete_time_client_aliases" on public.time_client_aliases
  for delete using (public.is_active_admin());

create policy "admin_select_time_forecasts" on public.time_forecasts
  for select using (public.is_active_admin());
create policy "admin_insert_time_forecasts" on public.time_forecasts
  for insert with check (public.is_active_admin());
create policy "admin_update_time_forecasts" on public.time_forecasts
  for update using (public.is_active_admin()) with check (public.is_active_admin());
create policy "admin_delete_time_forecasts" on public.time_forecasts
  for delete using (public.is_active_admin());

create policy "admin_select_time_actual_groups" on public.time_actual_groups
  for select using (public.is_active_admin());
create policy "admin_insert_time_actual_groups" on public.time_actual_groups
  for insert with check (public.is_active_admin());
create policy "admin_update_time_actual_groups" on public.time_actual_groups
  for update using (public.is_active_admin()) with check (public.is_active_admin());
create policy "admin_delete_time_actual_groups" on public.time_actual_groups
  for delete using (public.is_active_admin());

alter publication supabase_realtime add table public.time_import_batches;
alter publication supabase_realtime add table public.time_actuals;
alter publication supabase_realtime add table public.time_forecasts;
alter publication supabase_realtime add table public.time_actual_groups;
