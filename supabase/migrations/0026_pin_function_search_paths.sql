-- Backlog item 61 Phase 3 — fixes Supabase advisors: functions with a
-- mutable search_path (no explicit `set search_path` clause). Even though
-- all four of these are security INVOKER (not security definer), so they
-- run with the caller's privileges rather than the function owner's,
-- Supabase's security advisor flags any function without a pinned
-- search_path because a mutable search_path is a prerequisite for
-- search_path injection attacks on security-definer functions that might
-- call them transitively. Pinning it is the standard fix and is harmless.
--
-- All four are recreated verbatim from their original migrations (0001,
-- 0003, 0009, 0017) with only the `set search_path = public` clause added.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_audit_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by = auth.uid();
  end if;
  new.updated_by = auth.uid();
  return new;
end;
$$;

-- prevent_reporting_cycle was originally created in 0003, then replaced in
-- 0009 (org_chart_id scoping). Recreate the 0009 version with search_path.
create or replace function public.prevent_reporting_cycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  is_cyclic boolean;
begin
  with recursive ancestors as (
    select manager_id as node from public.reporting_relationships
      where employee_id = new.manager_id and org_chart_id = new.org_chart_id
    union
    select rr.manager_id
      from public.reporting_relationships rr
      join ancestors a on rr.employee_id = a.node
      where rr.org_chart_id = new.org_chart_id
  )
  select exists (select 1 from ancestors where node = new.employee_id)
    into is_cyclic;

  if is_cyclic then
    raise exception 'Cycle detected: employee % cannot report to % (would create a reporting cycle)',
      new.employee_id, new.manager_id;
  end if;

  return new;
end;
$$;

-- enforce_org_chart_privacy_owner_only from 0017 — security INVOKER (not
-- definer), but advisors flag it anyway. No behavior change, just the
-- search_path pin.
create or replace function public.enforce_org_chart_privacy_owner_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.visibility is distinct from old.visibility
     and not public.is_active_admin()
     and old.created_by is distinct from auth.uid() then
    raise exception 'Only the chart owner or an admin can change its visibility';
  end if;
  return new;
end;
$$;
