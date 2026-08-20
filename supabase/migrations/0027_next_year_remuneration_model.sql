-- Treats N+1 the same way as N: one shared etp_vendu_next_year column,
-- bucketed into vendu/prevu by its OWN remuneration_model_next_year flag —
-- same mechanism as the current year's etp_vendu/remuneration_model, but a
-- separate flag so an N+1 edit can never retroactively change N's own
-- classification (see 0026's own comment for why that coupling was
-- rejected the first time around; this migration replaces that design with
-- the symmetric one instead, per user request). No production data has
-- ever been entered into etp_vendu_next_year/etp_expected_next_year (both
-- confirmed all-null before this migration), so no data-preserving backfill
-- is needed.
alter table public.assignments add column remuneration_model_next_year public.remuneration_model;

alter table public.assignments drop constraint chk_etp_expected_next_year_range;
alter table public.assignments drop column etp_expected_next_year;
