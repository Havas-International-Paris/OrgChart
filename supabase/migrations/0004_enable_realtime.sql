-- Supabase requires tables to be explicitly added to the `supabase_realtime`
-- publication before postgres_changes events are broadcast to subscribers.
-- Without this, .channel(...).on('postgres_changes', ...) silently never fires.
alter publication supabase_realtime add table public.employees;
alter publication supabase_realtime add table public.reporting_relationships;
alter publication supabase_realtime add table public.clients_missions;
alter publication supabase_realtime add table public.assignments;
