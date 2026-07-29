-- Nullable: null means "use the computed palette color" (departmentColor.ts),
-- so existing departments keep their current look until someone explicitly
-- picks a color. No new RLS policy needed — departments' existing policies
-- are table-scoped, not column-scoped.
alter table public.departments add column color text;
