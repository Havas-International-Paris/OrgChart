-- Backlog item 53 Phase B: per-chart ownership/privacy on top of Phase A's
-- global roles (0015_user_roles.sql). A chart is private (owner-only
-- read/write) by default; the owner can flip it public or grant specific
-- other accounts read ("lecteur") or write ("editeur") access, independent
-- of that account's own global role.

alter table public.org_charts add column visibility text not null default 'private'
  check (visibility in ('private', 'public'));

-- Backfill: every chart that exists BEFORE this migration (including the
-- registry, which non-admin editeurs must keep reading/importing from —
-- see useRegistryImport.ts) becomes public. Nobody loses access on deploy
-- day, same bootstrap principle as 0015's "grandfather everyone as admin".
update public.org_charts set visibility = 'public';

create table public.org_chart_access (
  org_chart_id uuid not null references public.org_charts(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null check (role in ('lecteur', 'editeur')),
  created_at   timestamptz not null default now(),
  primary key (org_chart_id, user_id)
);

alter table public.org_chart_access enable row level security;
alter publication supabase_realtime add table public.org_chart_access;

-- Access helpers, security definer + stable like is_active_user() etc. (see
-- 0015_user_roles.sql) so policies stay one-liners and can't recurse.
create or replace function public.can_read_org_chart(p_chart_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_user() and (
    public.is_active_admin()
    or exists (
      select 1 from public.org_charts oc
      where oc.id = p_chart_id and (oc.created_by = auth.uid() or oc.visibility = 'public')
    )
    or exists (
      select 1 from public.org_chart_access a
      where a.org_chart_id = p_chart_id and a.user_id = auth.uid()
    )
  );
$$;

create or replace function public.can_write_org_chart(p_chart_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_user() and (
    public.is_active_admin()
    or exists (
      select 1 from public.org_charts oc
      where oc.id = p_chart_id and oc.created_by = auth.uid()
    )
    or exists (
      select 1 from public.org_chart_access a
      where a.org_chart_id = p_chart_id and a.user_id = auth.uid() and a.role = 'editeur'
    )
    or (
      public.is_active_editor_or_admin()
      and exists (select 1 from public.org_charts oc where oc.id = p_chart_id and oc.visibility = 'public')
    )
  );
$$;

-- RLS alone can't express "editors can rename but only the owner/admin can
-- flip public<->private" in one UPDATE policy (multiple policies for the
-- same command OR together, they can't be combined as a column-scoped AND).
-- A trigger checks the one privacy-sensitive column instead.
create or replace function public.enforce_org_chart_privacy_owner_only()
returns trigger
language plpgsql
as $$
begin
  if new.visibility is distinct from old.visibility
     and not public.is_active_admin()
     and old.created_by is distinct from auth.uid() then
    raise exception 'Only the chart owner or an admin can change its visibility';
  end if;
  return new;
end;
$$;

create trigger trg_org_charts_privacy_owner_only before update on public.org_charts
  for each row execute function public.enforce_org_chart_privacy_owner_only();

-- org_charts: replace 0015's global-only policies with chart-aware ones.
drop policy "active_select_org_charts" on public.org_charts;
drop policy "editor_insert_org_charts" on public.org_charts;
drop policy "editor_update_org_charts" on public.org_charts;
drop policy "editor_delete_org_charts" on public.org_charts;

create policy "chart_select_org_charts" on public.org_charts
  for select using (public.can_read_org_chart(id));
create policy "editor_insert_org_charts" on public.org_charts
  for insert with check (public.is_active_editor_or_admin());
create policy "chart_update_org_charts" on public.org_charts
  for update using (public.can_write_org_chart(id)) with check (public.can_write_org_chart(id));
-- Delete stays owner/admin only — a shared editor can edit content but not
-- delete the whole chart.
create policy "owner_delete_org_charts" on public.org_charts
  for delete using (public.is_active_admin() or created_by = auth.uid());

-- org_chart_access: managed by the chart's owner or an admin only. Anyone
-- can read their OWN grant (so a shared user's own client can tell they
-- have access) in addition to the owner/admin managing the whole list.
create policy "select_own_or_owner_or_admin_org_chart_access" on public.org_chart_access
  for select using (
    user_id = auth.uid()
    or public.is_active_admin()
    or exists (select 1 from public.org_charts oc where oc.id = org_chart_id and oc.created_by = auth.uid())
  );
create policy "owner_or_admin_insert_org_chart_access" on public.org_chart_access
  for insert with check (
    public.is_active_admin()
    or exists (select 1 from public.org_charts oc where oc.id = org_chart_id and oc.created_by = auth.uid())
  );
create policy "owner_or_admin_update_org_chart_access" on public.org_chart_access
  for update using (
    public.is_active_admin()
    or exists (select 1 from public.org_charts oc where oc.id = org_chart_id and oc.created_by = auth.uid())
  );
create policy "owner_or_admin_delete_org_chart_access" on public.org_chart_access
  for delete using (
    public.is_active_admin()
    or exists (select 1 from public.org_charts oc where oc.id = org_chart_id and oc.created_by = auth.uid())
  );

-- employees / reporting_relationships / assignments: replace 0015's
-- global-only active_select_*/editor_*_* policies with chart-aware ones.
-- job_titles/departments/clients_missions are unaffected — they stay
-- global catalogs gated only by the global role, per CLAUDE.md.

drop policy "active_select_employees" on public.employees;
drop policy "editor_insert_employees" on public.employees;
drop policy "editor_update_employees" on public.employees;
drop policy "editor_delete_employees" on public.employees;
create policy "chart_select_employees" on public.employees
  for select using (public.can_read_org_chart(org_chart_id));
create policy "chart_insert_employees" on public.employees
  for insert with check (public.can_write_org_chart(org_chart_id));
create policy "chart_update_employees" on public.employees
  for update using (public.can_write_org_chart(org_chart_id)) with check (public.can_write_org_chart(org_chart_id));
create policy "chart_delete_employees" on public.employees
  for delete using (public.can_write_org_chart(org_chart_id));

drop policy "active_select_reporting" on public.reporting_relationships;
drop policy "editor_insert_reporting" on public.reporting_relationships;
drop policy "editor_update_reporting" on public.reporting_relationships;
drop policy "editor_delete_reporting" on public.reporting_relationships;
create policy "chart_select_reporting" on public.reporting_relationships
  for select using (public.can_read_org_chart(org_chart_id));
create policy "chart_insert_reporting" on public.reporting_relationships
  for insert with check (public.can_write_org_chart(org_chart_id));
create policy "chart_update_reporting" on public.reporting_relationships
  for update using (public.can_write_org_chart(org_chart_id)) with check (public.can_write_org_chart(org_chart_id));
create policy "chart_delete_reporting" on public.reporting_relationships
  for delete using (public.can_write_org_chart(org_chart_id));

drop policy "active_select_assignments" on public.assignments;
drop policy "editor_insert_assignments" on public.assignments;
drop policy "editor_update_assignments" on public.assignments;
drop policy "editor_delete_assignments" on public.assignments;
create policy "chart_select_assignments" on public.assignments
  for select using (public.can_read_org_chart(org_chart_id));
create policy "chart_insert_assignments" on public.assignments
  for insert with check (public.can_write_org_chart(org_chart_id));
create policy "chart_update_assignments" on public.assignments
  for update using (public.can_write_org_chart(org_chart_id)) with check (public.can_write_org_chart(org_chart_id));
create policy "chart_delete_assignments" on public.assignments
  for delete using (public.can_write_org_chart(org_chart_id));

-- Lets a chart owner pick who to share with without needing user_roles'
-- own admin-gated SELECT policy (own_or_admin_select_user_roles) — exposes
-- only id+email for ACTIVE accounts, never role/status.
create or replace function public.list_active_users()
returns table(user_id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  select user_id, email from public.user_roles where status = 'active';
$$;

grant execute on function public.list_active_users() to authenticated;
