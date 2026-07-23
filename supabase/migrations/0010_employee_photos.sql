-- Employee photo uploads: a public Storage bucket (mirrors this app's
-- existing security model — every authenticated user can already edit or
-- delete anything, see "Known issues" in CLAUDE.md/README) plus a nullable
-- photo_path column on employees pointing at the object within it.
insert into storage.buckets (id, name, public) values ('employee-photos', 'employee-photos', true);

create policy "authenticated_select_employee_photos" on storage.objects
  for select using (bucket_id = 'employee-photos' and auth.role() = 'authenticated');
create policy "authenticated_insert_employee_photos" on storage.objects
  for insert with check (bucket_id = 'employee-photos' and auth.role() = 'authenticated');
create policy "authenticated_update_employee_photos" on storage.objects
  for update using (bucket_id = 'employee-photos' and auth.role() = 'authenticated')
  with check (bucket_id = 'employee-photos' and auth.role() = 'authenticated');
create policy "authenticated_delete_employee_photos" on storage.objects
  for delete using (bucket_id = 'employee-photos' and auth.role() = 'authenticated');

alter table public.employees add column photo_path text;
