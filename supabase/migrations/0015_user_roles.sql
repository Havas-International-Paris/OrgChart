-- Global roles (admin/editeur/lecteur) — foundation for backlog item 53.
-- Scope note: this migration does NOT add per-org-chart visibility/sharing
-- (org_chart_visibility/org_chart_access) — that's a separate, later
-- migration. Every active account can still read every chart after this
-- migration; what changes is WRITE access (editeur/admin only) and whether
-- an account can read/write AT ALL (must be status='active').

create table public.user_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       text not null default 'lecteur' check (role in ('admin', 'editeur', 'lecteur')),
  status     text not null default 'pending' check (status in ('pending', 'active')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_user_roles_updated_at before update on public.user_roles
  for each row execute function public.set_updated_at();

alter table public.user_roles enable row level security;
alter publication supabase_realtime add table public.user_roles;

-- Bootstrap: every account that exists BEFORE this migration keeps full
-- access it already had — nobody currently editing the chart loses access
-- on deploy day. Only signups AFTER this migration go through approval.
insert into public.user_roles (user_id, email, role, status)
select id, coalesce(email, ''), 'admin', 'active' from auth.users
on conflict (user_id) do nothing;

-- Every future signup lands as a pending lecteur until an admin approves it.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_roles (user_id, email, role, status)
  values (new.id, coalesce(new.email, ''), 'lecteur', 'pending')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Helpers used by every RLS policy below. security definer + stable so
-- policies stay one-liners and can't recurse into user_roles' own RLS (a
-- plain `using` clause querying user_roles directly would otherwise need
-- user_roles' own SELECT policy to already be satisfied, which is circular
-- for a non-admin checking their own write permission on a DIFFERENT table).
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.user_roles where user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.is_active_editor_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.user_roles where user_id = auth.uid() and status = 'active') in ('admin', 'editeur'),
    false
  );
$$;

create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.user_roles where user_id = auth.uid() and status = 'active') = 'admin',
    false
  );
$$;

-- user_roles' own RLS: everyone can read their OWN row (so a pending user's
-- own client can tell they're pending); only an active admin sees/edits
-- everyone else's. No insert policy for regular clients — rows are only
-- ever created by the trigger above (security definer, bypasses RLS) or the
-- backfill just above it.
create policy "own_or_admin_select_user_roles" on public.user_roles
  for select using (user_id = auth.uid() or public.is_active_admin());
create policy "admin_update_user_roles" on public.user_roles
  for update using (public.is_active_admin()) with check (public.is_active_admin());
create policy "admin_delete_user_roles" on public.user_roles
  for delete using (public.is_active_admin());

-- Replace every existing "authenticated_*" policy (auth.role() =
-- 'authenticated' only) with role-aware versions: SELECT requires an ACTIVE
-- account (a pending account fails every policy, read included), write
-- requires editeur or admin. Same drop+recreate shape for all 7 tables that
-- previously only checked auth.role().

-- employees (from 0002_rls_policies.sql)
drop policy "authenticated_select_employees" on public.employees;
drop policy "authenticated_insert_employees" on public.employees;
drop policy "authenticated_update_employees" on public.employees;
drop policy "authenticated_delete_employees" on public.employees;
create policy "active_select_employees" on public.employees
  for select using (public.is_active_user());
create policy "editor_insert_employees" on public.employees
  for insert with check (public.is_active_editor_or_admin());
create policy "editor_update_employees" on public.employees
  for update using (public.is_active_editor_or_admin()) with check (public.is_active_editor_or_admin());
create policy "editor_delete_employees" on public.employees
  for delete using (public.is_active_editor_or_admin());

-- reporting_relationships (from 0002_rls_policies.sql)
drop policy "authenticated_select_reporting" on public.reporting_relationships;
drop policy "authenticated_insert_reporting" on public.reporting_relationships;
drop policy "authenticated_update_reporting" on public.reporting_relationships;
drop policy "authenticated_delete_reporting" on public.reporting_relationships;
create policy "active_select_reporting" on public.reporting_relationships
  for select using (public.is_active_user());
create policy "editor_insert_reporting" on public.reporting_relationships
  for insert with check (public.is_active_editor_or_admin());
create policy "editor_update_reporting" on public.reporting_relationships
  for update using (public.is_active_editor_or_admin()) with check (public.is_active_editor_or_admin());
create policy "editor_delete_reporting" on public.reporting_relationships
  for delete using (public.is_active_editor_or_admin());

-- clients_missions (from 0002_rls_policies.sql)
drop policy "authenticated_select_clients_missions" on public.clients_missions;
drop policy "authenticated_insert_clients_missions" on public.clients_missions;
drop policy "authenticated_update_clients_missions" on public.clients_missions;
drop policy "authenticated_delete_clients_missions" on public.clients_missions;
create policy "active_select_clients_missions" on public.clients_missions
  for select using (public.is_active_user());
create policy "editor_insert_clients_missions" on public.clients_missions
  for insert with check (public.is_active_editor_or_admin());
create policy "editor_update_clients_missions" on public.clients_missions
  for update using (public.is_active_editor_or_admin()) with check (public.is_active_editor_or_admin());
create policy "editor_delete_clients_missions" on public.clients_missions
  for delete using (public.is_active_editor_or_admin());

-- assignments (from 0002_rls_policies.sql)
drop policy "authenticated_select_assignments" on public.assignments;
drop policy "authenticated_insert_assignments" on public.assignments;
drop policy "authenticated_update_assignments" on public.assignments;
drop policy "authenticated_delete_assignments" on public.assignments;
create policy "active_select_assignments" on public.assignments
  for select using (public.is_active_user());
create policy "editor_insert_assignments" on public.assignments
  for insert with check (public.is_active_editor_or_admin());
create policy "editor_update_assignments" on public.assignments
  for update using (public.is_active_editor_or_admin()) with check (public.is_active_editor_or_admin());
create policy "editor_delete_assignments" on public.assignments
  for delete using (public.is_active_editor_or_admin());

-- job_titles (from 0005_job_titles.sql)
drop policy "authenticated_select_job_titles" on public.job_titles;
drop policy "authenticated_insert_job_titles" on public.job_titles;
drop policy "authenticated_update_job_titles" on public.job_titles;
drop policy "authenticated_delete_job_titles" on public.job_titles;
create policy "active_select_job_titles" on public.job_titles
  for select using (public.is_active_user());
create policy "editor_insert_job_titles" on public.job_titles
  for insert with check (public.is_active_editor_or_admin());
create policy "editor_update_job_titles" on public.job_titles
  for update using (public.is_active_editor_or_admin()) with check (public.is_active_editor_or_admin());
create policy "editor_delete_job_titles" on public.job_titles
  for delete using (public.is_active_editor_or_admin());

-- departments (from 0008_departments.sql)
drop policy "authenticated_select_departments" on public.departments;
drop policy "authenticated_insert_departments" on public.departments;
drop policy "authenticated_update_departments" on public.departments;
drop policy "authenticated_delete_departments" on public.departments;
create policy "active_select_departments" on public.departments
  for select using (public.is_active_user());
create policy "editor_insert_departments" on public.departments
  for insert with check (public.is_active_editor_or_admin());
create policy "editor_update_departments" on public.departments
  for update using (public.is_active_editor_or_admin()) with check (public.is_active_editor_or_admin());
create policy "editor_delete_departments" on public.departments
  for delete using (public.is_active_editor_or_admin());

-- org_charts (from 0009_org_charts.sql)
drop policy "authenticated_select_org_charts" on public.org_charts;
drop policy "authenticated_insert_org_charts" on public.org_charts;
drop policy "authenticated_update_org_charts" on public.org_charts;
drop policy "authenticated_delete_org_charts" on public.org_charts;
create policy "active_select_org_charts" on public.org_charts
  for select using (public.is_active_user());
create policy "editor_insert_org_charts" on public.org_charts
  for insert with check (public.is_active_editor_or_admin());
create policy "editor_update_org_charts" on public.org_charts
  for update using (public.is_active_editor_or_admin()) with check (public.is_active_editor_or_admin());
create policy "editor_delete_org_charts" on public.org_charts
  for delete using (public.is_active_editor_or_admin());
