-- Backlog item 61 — Phase 2 auth/security hardening. Three independent
-- concerns, kept in one file because none depends on another and each is
-- small enough that splitting them into three migrations would just add
-- noise to the migrations folder.
--
-- (1) Storage policies on the employee-photos bucket were still using the
--     pre-roles `auth.role() = 'authenticated'` check from 0010, so a
--     status='pending' account (which 0015_user_roles.sql gates out of
--     every data table's RLS) could still upload / overwrite / delete
--     photos. Align the four policies on the same is_active_user() /
--     is_active_editor_or_admin() helpers every other table uses.
-- (2) user_roles.status only allows 'pending' / 'active'. refuseUser()
--     used to DELETE the row to ban a signup, which silently allowed a
--     re-signup with the same email (the auth.users row wasn't touched, so
--     the trigger re-fired and re-created a pending row). Adding 'refused'
--     lets refuseUser keep the row in place so the trigger's
--     on-conflict-do-nothing stays a permanent ban.
-- (3) reporting_relationships and assignments never got the set_audit_fields
--     trigger employees (0001) and org_charts (0018) have, so changes to
--     those two tables aren't attributed to a user. Adds the missing
--     created_by/updated_by columns and the trigger.

-- (1) Storage policies — drop the four authenticated_* policies from 0010
-- and recreate them role-aware. SELECT requires an active account (so a
-- pending account can't even read photos), writes require editeur/admin.
-- The bucket itself stays public:true (item 60 covers that separately),
-- so a public-URL fetch still works — these policies only govern what a
-- signed-in user can do through the authenticated Storage API.
drop policy if exists "authenticated_select_employee_photos" on storage.objects;
drop policy if exists "authenticated_insert_employee_photos" on storage.objects;
drop policy if exists "authenticated_update_employee_photos" on storage.objects;
drop policy if exists "authenticated_delete_employee_photos" on storage.objects;

create policy "active_select_employee_photos" on storage.objects
  for select using (bucket_id = 'employee-photos' and public.is_active_user());
create policy "editor_insert_employee_photos" on storage.objects
  for insert with check (bucket_id = 'employee-photos' and public.is_active_editor_or_admin());
create policy "editor_update_employee_photos" on storage.objects
  for update using (bucket_id = 'employee-photos' and public.is_active_editor_or_admin())
  with check (bucket_id = 'employee-photos' and public.is_active_editor_or_admin());
create policy "editor_delete_employee_photos" on storage.objects
  for delete using (bucket_id = 'employee-photos' and public.is_active_editor_or_admin());

-- (2) Add 'refused' to user_roles.status. The original check constraint was
-- declared inline (no explicit name) in 0015, so Postgres named it
-- user_roles_status_check — drop and recreate with the same convention so
-- any introspection tool keeps showing the expected name.
alter table public.user_roles drop constraint if exists user_roles_status_check;
alter table public.user_roles
  add constraint user_roles_status_check check (status in ('pending', 'active', 'refused'));

-- (3) Audit columns + trigger on reporting_relationships and assignments.
-- Both tables already had created_at/updated_at (0001) and the
-- set_updated_at trigger — they were just missing the per-user attribution
-- columns and the matching trigger. Nullable on purpose: existing rows
-- (all of them, predating this migration) stay null, same shape as the
-- org_charts backfill in 0018.
alter table public.reporting_relationships
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id);
alter table public.assignments
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id);

create trigger trg_reporting_audit before insert or update on public.reporting_relationships
  for each row execute function public.set_audit_fields();
create trigger trg_assignments_audit before insert or update on public.assignments
  for each row execute function public.set_audit_fields();
