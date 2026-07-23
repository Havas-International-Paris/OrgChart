-- Fixes a real, pre-existing bug: deleting a row in employees,
-- reporting_relationships, or assignments never reached OTHER mounted
-- consumers of the corresponding hook in real time (e.g. deleting an
-- employee from the grid left a stale card in the chart until a manual
-- reload, and vice versa) — INSERT/UPDATE always worked fine.
--
-- Root cause: each hook's postgres_changes subscription filters on
-- org_chart_id (see useEmployees.ts, useReportingGraph.ts,
-- useAssignments.ts), which is not the primary key. With the default
-- REPLICA IDENTITY (primary key only), a DELETE's write-ahead-log entry
-- doesn't carry org_chart_id at all, so Supabase Realtime can't evaluate
-- the filter for DELETE events and silently never delivers them to
-- filtered subscribers — this is a documented Supabase Realtime
-- limitation, not something the client code can work around.
alter table public.employees replica identity full;
alter table public.reporting_relationships replica identity full;
alter table public.assignments replica identity full;
