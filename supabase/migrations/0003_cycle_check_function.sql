create or replace function public.prevent_reporting_cycle()
returns trigger language plpgsql as $$
declare
  is_cyclic boolean;
begin
  with recursive ancestors as (
    select manager_id as node from public.reporting_relationships
      where employee_id = new.manager_id
    union
    select rr.manager_id
      from public.reporting_relationships rr
      join ancestors a on rr.employee_id = a.node
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

create trigger trg_prevent_cycle
  before insert or update on public.reporting_relationships
  for each row execute function public.prevent_reporting_cycle();
