create table public.departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

alter table public.employees add column department text;

alter table public.departments enable row level security;

create policy "authenticated_select_departments" on public.departments
  for select using (auth.role() = 'authenticated');
create policy "authenticated_insert_departments" on public.departments
  for insert with check (auth.role() = 'authenticated');
create policy "authenticated_update_departments" on public.departments
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_delete_departments" on public.departments
  for delete using (auth.role() = 'authenticated');

alter publication supabase_realtime add table public.departments;
