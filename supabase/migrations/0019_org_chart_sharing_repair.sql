-- Repairs an incomplete application of 0017_org_chart_sharing.sql. Verified
-- live via the read-only Supabase MCP after the user applied 0017/0018:
-- the org_chart_access table, the can_read/can_write functions, and the
-- privacy trigger all landed correctly, but the migration stopped partway
-- through the policy statements — org_charts ended up with a single
-- malformed policy (cmd=ALL, no USING clause, matching nothing), and
-- employees/reporting_relationships/assignments/org_chart_access never got
-- their new policies at all (employees etc. are still running 0015's
-- global-only policies; org_chart_access has RLS enabled but zero
-- policies, which — since RLS defaults to deny — makes it fail silently
-- unusable). list_active_users() was also never created. Root cause
-- unclear (likely the SQL editor stopping partway through the file); this
-- migration is written idempotently (IF EXISTS on every drop) so it's safe
-- to run regardless of exactly what state 0017 left things in.

drop policy if exists "active_select_org_charts" on public.org_charts;
drop policy if exists "editor_insert_org_charts" on public.org_charts;
drop policy if exists "editor_update_org_charts" on public.org_charts;
drop policy if exists "editor_delete_org_charts" on public.org_charts;
drop policy if exists "chart_select_org_charts" on public.org_charts;
drop policy if exists "chart_update_org_charts" on public.org_charts;
drop policy if exists "owner_delete_org_charts" on public.org_charts;

create policy "chart_select_org_charts" on public.org_charts
  for select using (public.can_read_org_chart(id));
create policy "editor_insert_org_charts" on public.org_charts
  for insert with check (public.is_active_editor_or_admin());
create policy "chart_update_org_charts" on public.org_charts
  for update using (public.can_write_org_chart(id)) with check (public.can_write_org_chart(id));
create policy "owner_delete_org_charts" on public.org_charts
  for delete using (public.is_active_admin() or created_by = auth.uid());

drop policy if exists "select_own_or_owner_or_admin_org_chart_access" on public.org_chart_access;
drop policy if exists "owner_or_admin_insert_org_chart_access" on public.org_chart_access;
drop policy if exists "owner_or_admin_update_org_chart_access" on public.org_chart_access;
drop policy if exists "owner_or_admin_delete_org_chart_access" on public.org_chart_access;

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

drop policy if exists "active_select_employees" on public.employees;
drop policy if exists "editor_insert_employees" on public.employees;
drop policy if exists "editor_update_employees" on public.employees;
drop policy if exists "editor_delete_employees" on public.employees;
drop policy if exists "chart_select_employees" on public.employees;
drop policy if exists "chart_insert_employees" on public.employees;
drop policy if exists "chart_update_employees" on public.employees;
drop policy if exists "chart_delete_employees" on public.employees;
create policy "chart_select_employees" on public.employees
  for select using (public.can_read_org_chart(org_chart_id));
create policy "chart_insert_employees" on public.employees
  for insert with check (public.can_write_org_chart(org_chart_id));
create policy "chart_update_employees" on public.employees
  for update using (public.can_write_org_chart(org_chart_id)) with check (public.can_write_org_chart(org_chart_id));
create policy "chart_delete_employees" on public.employees
  for delete using (public.can_write_org_chart(org_chart_id));

drop policy if exists "active_select_reporting" on public.reporting_relationships;
drop policy if exists "editor_insert_reporting" on public.reporting_relationships;
drop policy if exists "editor_update_reporting" on public.reporting_relationships;
drop policy if exists "editor_delete_reporting" on public.reporting_relationships;
drop policy if exists "chart_select_reporting" on public.reporting_relationships;
drop policy if exists "chart_insert_reporting" on public.reporting_relationships;
drop policy if exists "chart_update_reporting" on public.reporting_relationships;
drop policy if exists "chart_delete_reporting" on public.reporting_relationships;
create policy "chart_select_reporting" on public.reporting_relationships
  for select using (public.can_read_org_chart(org_chart_id));
create policy "chart_insert_reporting" on public.reporting_relationships
  for insert with check (public.can_write_org_chart(org_chart_id));
create policy "chart_update_reporting" on public.reporting_relationships
  for update using (public.can_write_org_chart(org_chart_id)) with check (public.can_write_org_chart(org_chart_id));
create policy "chart_delete_reporting" on public.reporting_relationships
  for delete using (public.can_write_org_chart(org_chart_id));

drop policy if exists "active_select_assignments" on public.assignments;
drop policy if exists "editor_insert_assignments" on public.assignments;
drop policy if exists "editor_update_assignments" on public.assignments;
drop policy if exists "editor_delete_assignments" on public.assignments;
drop policy if exists "chart_select_assignments" on public.assignments;
drop policy if exists "chart_insert_assignments" on public.assignments;
drop policy if exists "chart_update_assignments" on public.assignments;
drop policy if exists "chart_delete_assignments" on public.assignments;
create policy "chart_select_assignments" on public.assignments
  for select using (public.can_read_org_chart(org_chart_id));
create policy "chart_insert_assignments" on public.assignments
  for insert with check (public.can_write_org_chart(org_chart_id));
create policy "chart_update_assignments" on public.assignments
  for update using (public.can_write_org_chart(org_chart_id)) with check (public.can_write_org_chart(org_chart_id));
create policy "chart_delete_assignments" on public.assignments
  for delete using (public.can_write_org_chart(org_chart_id));

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
