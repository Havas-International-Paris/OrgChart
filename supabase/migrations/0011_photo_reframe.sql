-- Interactive photo reframing (phase 5b of the design handoff): lets a user
-- pan/zoom their cover-fit avatar instead of only getting the automatic
-- center crop from 0010. Stored as plain numbers so every render site (chart
-- card, grid cell, reframe editor) applies the same cheap CSS transform —
-- no server-side re-encoding of the image itself.
alter table public.employees
  add column photo_zoom numeric not null default 1,
  add column photo_pan_x numeric not null default 0,
  add column photo_pan_y numeric not null default 0;

alter table public.employees
  add constraint employees_photo_zoom_range check (photo_zoom >= 1 and photo_zoom <= 4),
  add constraint employees_photo_pan_x_range check (photo_pan_x >= -100 and photo_pan_x <= 100),
  add constraint employees_photo_pan_y_range check (photo_pan_y >= -100 and photo_pan_y <= 100);
