-- "% sold N+1" / "% expected N+1" — the Time Estimation grid's new forward-
-- looking forecast columns (TimeEstimationGrid.tsx), let an admin hand-enter
-- a next-year projection based on this year's trend, independent of the
-- current year's own vendu/prevu (which live in etp_vendu, bucketed by
-- remuneration_model). Deliberately two SEPARATE columns rather than
-- reusing that same shared-column-plus-model-flag trick: doing so would mean
-- editing a next-year forecast could retroactively flip the CURRENT year's
-- own remuneration_model (and therefore its vendu/prevu classification) as
-- a side effect, which would be a confusing surprise. Mutual exclusivity
-- between the two (only one of them non-zero per row) is enforced by the
-- app writing both together on every edit, not by a DB constraint — see
-- CLAUDE.md's note on the now-removed chk_commission_no_vendu for why a
-- constraint that has to track application-level bucketing logic is a risk
-- worth avoiding here.
alter table public.assignments add column etp_vendu_next_year numeric(5,2);
alter table public.assignments add column etp_expected_next_year numeric(5,2);

alter table public.assignments add constraint chk_etp_vendu_next_year_range
  check (etp_vendu_next_year is null or (etp_vendu_next_year >= 0 and etp_vendu_next_year <= 100));
alter table public.assignments add constraint chk_etp_expected_next_year_range
  check (etp_expected_next_year is null or (etp_expected_next_year >= 0 and etp_expected_next_year <= 100));
