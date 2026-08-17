-- Revision of "Estimation des temps" (0021): replaces the single
-- time_forecasts.planned_pct (one value for the whole remaining period)
-- with a per-month manual override, editable for ANY month of the year
-- (past or remaining) — see CLAUDE.md/plan for the 3-level cascade UX
-- this enables (edit a month / edit a section average / edit the year
-- total, each fills the months it covers).
--
-- Never overwrites time_actuals directly: a month's "effective" value is
-- override ?? sum(resolved time_actuals for that month), computed
-- application-side. This avoids an ambiguous write-back into time_actuals,
-- where several raw imported rows (different raw_client_name/raw_sous_dossier)
-- can resolve to the same (employee, client, month).

create table public.time_forecast_months (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees(id) on delete cascade,
  client_mission_id  uuid not null references public.clients_missions(id) on delete cascade,
  year               int not null,
  month              int not null check (month between 1 and 12),
  pct                numeric not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (employee_id, client_mission_id, year, month)
);

create trigger trg_time_forecast_months_updated_at before update on public.time_forecast_months
  for each row execute function public.set_updated_at();

alter table public.time_forecast_months enable row level security;

create policy "admin_select_time_forecast_months" on public.time_forecast_months
  for select using (public.is_active_admin());
create policy "admin_insert_time_forecast_months" on public.time_forecast_months
  for insert with check (public.is_active_admin());
create policy "admin_update_time_forecast_months" on public.time_forecast_months
  for update using (public.is_active_admin()) with check (public.is_active_admin());
create policy "admin_delete_time_forecast_months" on public.time_forecast_months
  for delete using (public.is_active_admin());

alter publication supabase_realtime add table public.time_forecast_months;

alter table public.time_forecasts drop column planned_pct;
