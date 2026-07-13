alter table public.assignments rename column etp_percent to etp_vendu;

alter table public.assignments add column etp_reel numeric(5,2);

alter table public.assignments add constraint chk_etp_reel_range
  check (etp_reel is null or (etp_reel >= 0 and etp_reel <= 100));
