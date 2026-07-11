create extension if not exists "pgcrypto";

create table public.employees (
  id            uuid primary key default gen_random_uuid(),
  first_name    text not null,
  last_name     text not null,
  job_title     text,
  role_desc     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id)
);

create index idx_employees_last_name on public.employees (last_name);

create table public.reporting_relationships (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  manager_id    uuid not null references public.employees(id) on delete cascade,
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint chk_no_self_report check (employee_id <> manager_id),
  constraint uq_employee_manager unique (employee_id, manager_id)
);

-- At most one primary manager per employee.
create unique index uq_one_primary_manager
  on public.reporting_relationships (employee_id)
  where is_primary;

create index idx_reporting_employee on public.reporting_relationships (employee_id);
create index idx_reporting_manager  on public.reporting_relationships (manager_id);

create type public.client_mission_type as enum ('client', 'mission');

create table public.clients_missions (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  type          public.client_mission_type not null,
  created_at    timestamptz not null default now(),

  constraint uq_name_type unique (name, type)
);

create table public.assignments (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.employees(id) on delete cascade,
  client_mission_id uuid not null references public.clients_missions(id) on delete restrict,
  etp_percent       numeric(5,2) not null check (etp_percent > 0 and etp_percent <= 100),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint uq_employee_client_mission unique (employee_id, client_mission_id)
);

create index idx_assignments_employee on public.assignments (employee_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_employees_updated_at before update on public.employees
  for each row execute function public.set_updated_at();
create trigger trg_reporting_updated_at before update on public.reporting_relationships
  for each row execute function public.set_updated_at();
create trigger trg_assignments_updated_at before update on public.assignments
  for each row execute function public.set_updated_at();

create or replace function public.set_audit_fields()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by = auth.uid();
  end if;
  new.updated_by = auth.uid();
  return new;
end;
$$;

create trigger trg_employees_audit before insert or update on public.employees
  for each row execute function public.set_audit_fields();
