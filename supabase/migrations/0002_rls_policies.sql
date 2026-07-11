alter table public.employees enable row level security;
alter table public.reporting_relationships enable row level security;
alter table public.clients_missions enable row level security;
alter table public.assignments enable row level security;

create policy "authenticated_select_employees" on public.employees
  for select using (auth.role() = 'authenticated');
create policy "authenticated_insert_employees" on public.employees
  for insert with check (auth.role() = 'authenticated');
create policy "authenticated_update_employees" on public.employees
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_delete_employees" on public.employees
  for delete using (auth.role() = 'authenticated');

create policy "authenticated_select_reporting" on public.reporting_relationships
  for select using (auth.role() = 'authenticated');
create policy "authenticated_insert_reporting" on public.reporting_relationships
  for insert with check (auth.role() = 'authenticated');
create policy "authenticated_update_reporting" on public.reporting_relationships
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_delete_reporting" on public.reporting_relationships
  for delete using (auth.role() = 'authenticated');

create policy "authenticated_select_clients_missions" on public.clients_missions
  for select using (auth.role() = 'authenticated');
create policy "authenticated_insert_clients_missions" on public.clients_missions
  for insert with check (auth.role() = 'authenticated');
create policy "authenticated_update_clients_missions" on public.clients_missions
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_delete_clients_missions" on public.clients_missions
  for delete using (auth.role() = 'authenticated');

create policy "authenticated_select_assignments" on public.assignments
  for select using (auth.role() = 'authenticated');
create policy "authenticated_insert_assignments" on public.assignments
  for insert with check (auth.role() = 'authenticated');
create policy "authenticated_update_assignments" on public.assignments
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_delete_assignments" on public.assignments
  for delete using (auth.role() = 'authenticated');
