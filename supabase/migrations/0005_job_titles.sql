create table public.job_titles (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

-- Pre-seed from whatever job_title values are already in use, so switching
-- the "Poste" column to a catalog-backed picklist doesn't blank out or
-- orphan existing employees' values.
insert into public.job_titles (name)
select distinct job_title from public.employees
where job_title is not null and job_title <> ''
on conflict (name) do nothing;

alter table public.job_titles enable row level security;

create policy "authenticated_select_job_titles" on public.job_titles
  for select using (auth.role() = 'authenticated');
create policy "authenticated_insert_job_titles" on public.job_titles
  for insert with check (auth.role() = 'authenticated');
create policy "authenticated_update_job_titles" on public.job_titles
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_delete_job_titles" on public.job_titles
  for delete using (auth.role() = 'authenticated');

alter publication supabase_realtime add table public.job_titles;
