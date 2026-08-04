-- Central employee registry — foundation for backlog item 58 Phase A
-- ([[cahier_des_charges_ux_ameliorations]] §8). The registry is a real
-- org_charts row (is_registry = true), reusing employees/reporting_relationships
-- as-is — no new tables for its own content. Phase A ships only the registry
-- chart itself + the import flow (flux 1); hidden_from_registry_candidates is
-- added now but stays unused until Phase B's "Salariés à promouvoir" tab
-- (flux 2), so that phase needs no migration of its own.

alter table public.org_charts add column is_registry boolean not null default false;

-- At most one registry chart can ever exist.
create unique index uq_one_registry_chart on public.org_charts (is_registry) where is_registry;

alter table public.employees add column hidden_from_registry_candidates boolean not null default false;

insert into public.org_charts (name, short_label, is_registry)
values ('Base centrale des salariés', 'Registre', true);
