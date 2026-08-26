-- Per-employee "has left the company" flag (user-requested feature, 2026-08).
-- Own dedicated setter (setHasLeftCompany), not part of EmployeeInput/
-- updateEmployee's plain create/edit flow — same precedent as
-- hidden_from_registry_candidates (0016_registry.sql). Drives a clickable
-- flag in the grid/chart and a global "hide departed employees" filter,
-- default on, applied everywhere an employee list is shown.

alter table public.employees add column has_left_company boolean not null default false;
