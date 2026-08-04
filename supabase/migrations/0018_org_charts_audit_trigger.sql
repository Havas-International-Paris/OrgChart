-- org_charts (0009_org_charts.sql) never got the set_audit_fields trigger
-- every other audited table has had since 0001_init_schema.sql — created_by
-- has been null for every chart ever created. Harmless before 0017 (nothing
-- read created_by), but 0017's ownership model needs it: without this, a
-- non-admin's brand-new PRIVATE chart has no owner match at all, silently
-- locking its own creator out of the chart they just created.
create trigger trg_org_charts_audit before insert or update on public.org_charts
  for each row execute function public.set_audit_fields();
