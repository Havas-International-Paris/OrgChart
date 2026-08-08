create table public.companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  color      text,
  created_at timestamptz not null default now()
);

alter table public.employees add column company text;

alter table public.companies enable row level security;

create policy "active_select_companies" on public.companies
  for select using (public.is_active_user());
create policy "editor_insert_companies" on public.companies
  for insert with check (public.is_active_editor_or_admin());
create policy "editor_update_companies" on public.companies
  for update using (public.is_active_editor_or_admin()) with check (public.is_active_editor_or_admin());
create policy "editor_delete_companies" on public.companies
  for delete using (public.is_active_editor_or_admin());

alter publication supabase_realtime add table public.companies;
