-- Manual sibling ordering (drag-to-reorder among same-manager coworkers).
-- NULL means "no manual order set" — dagre's own natural left-to-right
-- order is used, unchanged from current behavior. A sibling group (same
-- primary manager, or the shared root group) is backfilled to real,
-- evenly-spaced values only the first time any one member is manually
-- reordered — see layoutEngine.ts / OrgChartView.tsx.
alter table public.employees add column sibling_order double precision null;
