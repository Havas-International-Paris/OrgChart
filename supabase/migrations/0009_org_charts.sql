-- Support multiple independent org charts (scenarios). Existing data is
-- backfilled into one seed chart ("Organigramme principal"). clients_missions,
-- job_titles, and departments stay global/unscoped catalogs shared across all
-- charts (see CLAUDE.md); only employees, reporting_relationships, and
-- assignments become per-chart.

-- Block A: org_charts table
create table public.org_charts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  short_label   text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id)
);

create trigger trg_org_charts_updated_at before update on public.org_charts
  for each row execute function public.set_updated_at();

alter table public.org_charts enable row level security;

create policy "authenticated_select_org_charts" on public.org_charts
  for select using (auth.role() = 'authenticated');
create policy "authenticated_insert_org_charts" on public.org_charts
  for insert with check (auth.role() = 'authenticated');
create policy "authenticated_update_org_charts" on public.org_charts
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_delete_org_charts" on public.org_charts
  for delete using (auth.role() = 'authenticated');

alter publication supabase_realtime add table public.org_charts;

-- Block B: scope employees / reporting_relationships / assignments to a chart
insert into public.org_charts (name, short_label) values ('Organigramme principal', 'Principal');

alter table public.employees add column org_chart_id uuid references public.org_charts(id) on delete cascade;
alter table public.reporting_relationships add column org_chart_id uuid references public.org_charts(id) on delete cascade;
alter table public.assignments add column org_chart_id uuid references public.org_charts(id) on delete cascade;

update public.employees set org_chart_id = (select id from public.org_charts limit 1);
update public.reporting_relationships set org_chart_id = (select id from public.org_charts limit 1);
update public.assignments set org_chart_id = (select id from public.org_charts limit 1);

alter table public.employees alter column org_chart_id set not null;
alter table public.reporting_relationships alter column org_chart_id set not null;
alter table public.assignments alter column org_chart_id set not null;

create index idx_employees_org_chart on public.employees (org_chart_id);
create index idx_reporting_org_chart on public.reporting_relationships (org_chart_id);
create index idx_assignments_org_chart on public.assignments (org_chart_id);

-- Block C: re-scope composite uniqueness to be per-chart
alter table public.reporting_relationships drop constraint uq_employee_manager;
alter table public.reporting_relationships add constraint uq_employee_manager
  unique (org_chart_id, employee_id, manager_id);

drop index public.uq_one_primary_manager;
create unique index uq_one_primary_manager
  on public.reporting_relationships (org_chart_id, employee_id)
  where is_primary;

alter table public.assignments drop constraint uq_employee_client_mission;
alter table public.assignments add constraint uq_employee_client_mission
  unique (org_chart_id, employee_id, client_mission_id);

-- Block D: re-scope the cycle-check trigger so a relationship in one chart
-- can never affect a cycle check performed in another chart.
create or replace function public.prevent_reporting_cycle()
returns trigger language plpgsql as $$
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

-- Block E: duplicate_org_chart RPC — full independent copy of employees,
-- reporting_relationships, and assignments for one chart. client_mission_id
-- is copied as-is (not remapped): clients_missions is a shared global catalog.
create or replace function public.duplicate_org_chart(source_id uuid, new_name text, new_short_label text)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_chart_id uuid;
begin
  insert into public.org_charts (name, short_label) values (new_name, new_short_label)
    returning id into new_chart_id;

  create temporary table _org_chart_dup_map (old_id uuid primary key, new_id uuid not null) on commit drop;

  insert into _org_chart_dup_map (old_id, new_id)
    select id, gen_random_uuid() from public.employees where org_chart_id = source_id;

  insert into public.employees (id, first_name, last_name, job_title, role_desc, department, org_chart_id, created_by, updated_by)
    select m.new_id, e.first_name, e.last_name, e.job_title, e.role_desc, e.department, new_chart_id, e.created_by, e.updated_by
    from public.employees e join _org_chart_dup_map m on m.old_id = e.id
    where e.org_chart_id = source_id;

  insert into public.reporting_relationships (employee_id, manager_id, is_primary, org_chart_id)
    select me.new_id, mm.new_id, rr.is_primary, new_chart_id
    from public.reporting_relationships rr
    join _org_chart_dup_map me on me.old_id = rr.employee_id
    join _org_chart_dup_map mm on mm.old_id = rr.manager_id
    where rr.org_chart_id = source_id;

  insert into public.assignments (employee_id, client_mission_id, etp_vendu, etp_reel, remuneration_model, org_chart_id)
    select m.new_id, a.client_mission_id, a.etp_vendu, a.etp_reel, a.remuneration_model, new_chart_id
    from public.assignments a join _org_chart_dup_map m on m.old_id = a.employee_id
    where a.org_chart_id = source_id;

  return new_chart_id;
end;
$$;

grant execute on function public.duplicate_org_chart(uuid, text, text) to authenticated;
