-- Revision 2 of "Estimation des temps": the import source changed from a
-- single-year monthly export to a combined N-1 + N workbook (2 tabs). The
-- N-1 tab ("Input N-1", shape of the real "Evol Etps" Havas export) only
-- ever provides ONE annual total per (employee, client) — never a monthly
-- breakdown — so it can't be stored in time_actuals (month not null, built
-- for genuinely monthly data). This table is the dedicated home for that
-- single annual figure.

create table public.time_actual_n1_totals (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees(id) on delete cascade,
  client_mission_id  uuid not null references public.clients_missions(id) on delete cascade,
  year               int not null,
  total_pct          numeric not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (employee_id, client_mission_id, year)
);

create trigger trg_time_actual_n1_totals_updated_at before update on public.time_actual_n1_totals
  for each row execute function public.set_updated_at();

alter table public.time_actual_n1_totals enable row level security;

create policy "admin_select_time_actual_n1_totals" on public.time_actual_n1_totals
  for select using (public.is_active_admin());
create policy "admin_insert_time_actual_n1_totals" on public.time_actual_n1_totals
  for insert with check (public.is_active_admin());
create policy "admin_update_time_actual_n1_totals" on public.time_actual_n1_totals
  for update using (public.is_active_admin()) with check (public.is_active_admin());
create policy "admin_delete_time_actual_n1_totals" on public.time_actual_n1_totals
  for delete using (public.is_active_admin());

alter publication supabase_realtime add table public.time_actual_n1_totals;
