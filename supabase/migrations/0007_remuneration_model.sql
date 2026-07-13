create type public.remuneration_model as enum ('retainer', 'commission');

alter table public.assignments add column remuneration_model public.remuneration_model;

-- etp_vendu is no longer mandatory: commission-based assignments never carry a
-- vendu figure, only a réel one.
alter table public.assignments drop constraint if exists assignments_etp_percent_check;
alter table public.assignments alter column etp_vendu drop not null;
alter table public.assignments add constraint chk_etp_vendu_range
  check (etp_vendu is null or (etp_vendu >= 0 and etp_vendu <= 100));

-- Commission-based assignments must never carry a vendu figure.
alter table public.assignments add constraint chk_commission_no_vendu
  check (remuneration_model is distinct from 'commission' or etp_vendu is null);
