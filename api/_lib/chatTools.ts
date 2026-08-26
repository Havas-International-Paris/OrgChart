import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database, RemunerationModel } from '../../src/lib/database.types.js';

// One client per request, authenticated as the calling user's own session
// (their access token, forwarded from the browser) rather than a service-role
// key. This is deliberate: 0002_rls_policies.sql's policies only check
// `auth.role() = 'authenticated'`, so a per-request client built this way sees
// exactly what the user's own browser session would see via supabase-js — no
// broader access is granted to the chat than the rest of the app already has.
export function supabaseForUser(accessToken: string): SupabaseClient<Database> {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Supabase is not configured on the server (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing).');
  }
  return createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Every tool is scoped to the org chart the user currently has open — see
// docs/chat-ia-cahier-des-charges.md §3/§5. orgChartId is bound by the caller
// (chatHandler.ts) from the client's currentOrgChartId, never a model-chosen
// argument, so it isn't part of any tool's parameter schema below.
export interface ToolContext {
  supabase: SupabaseClient<Database>;
  orgChartId: string;
  // Mirrors the client's uiPreferencesStore "hide departed employees"
  // toggle — every employee-listing query below excludes has_left_company
  // rows when true, same default-on behavior as the grid/chart.
  hideDepartedEmployees: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;
}

function employeeLabel(e: { first_name: string; last_name: string }) {
  return `${e.first_name} ${e.last_name}`;
}

// Job title and department are catalog-backed picklists everywhere else in
// the app (EmployeeGrid's "Poste"/"Business Unit" columns are select-only,
// no free text — see CLAUDE.md) — the catalog entry has to already exist
// before it's selectable. The chat's write tools bypass that UI-level gate
// entirely (they write straight to employees.job_title/department), so a
// value the model invents or accepts from the user never appeared in the
// Postes/Business Units tabs, even though employees.job_title/department
// have no FK enforcing the relationship and happily stored it anyway. Real
// bug, reported by the user: asked the chat to fill in a few people's
// missing job titles, the grid updated correctly but the new titles never
// showed up in the "Postes" tab. Fixed by having every write path that sets
// job_title/department also upsert that value into the matching catalog
// table first — mirrors what a user going through Postes/Business Units
// first, then the grid, would have produced by hand. Both catalog tables
// have a `unique` constraint on `name` (0005_job_titles.sql,
// 0008_departments.sql), so `ignoreDuplicates` makes this a no-op for an
// already-known value instead of an error.
async function ensureCatalogEntry(
  supabase: SupabaseClient<Database>,
  table: 'job_titles' | 'departments',
  name: string | null | undefined,
): Promise<void> {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return;
  const { error } = await supabase.from(table).upsert({ name: trimmed }, { onConflict: 'name', ignoreDuplicates: true });
  // Non-fatal on purpose: the employee's own field is the source of truth the
  // user asked to change, and RLS or a race on the catalog table shouldn't
  // block that write from succeeding.
  if (error) console.error(`[chatTools] ensureCatalogEntry(${table}, "${trimmed}") failed:`, error.message);
}

// Same "resolve or create" shape as ensureCatalogEntry above, but can't
// reuse it: job_titles/departments back a plain TEXT column with no FK (the
// employee row just needs a MATCHING catalog row to exist, its own field
// stores the string directly), while assignments.client_mission_id is a
// real FK (`on delete restrict`) — the caller needs the actual id back,
// whether the catalog entry already existed or was just created. Mirrors
// the frontend's own useClientsMissions.ts findOrCreate (same
// case-insensitive name+type match, create if nothing matches) rather than
// inventing a different resolution rule server-side.
async function findOrCreateClientMission(
  supabase: SupabaseClient<Database>,
  name: string,
  type: 'client' | 'mission',
): Promise<{ id: string; created: boolean }> {
  const trimmed = name.trim();
  const { data: matches, error: findError } = await supabase
    .from('clients_missions')
    .select('id')
    .eq('type', type)
    .ilike('name', trimmed)
    .limit(1);
  if (findError) throw findError;
  if (matches && matches.length > 0) return { id: matches[0].id, created: false };

  const { data: created, error: createError } = await supabase
    .from('clients_missions')
    .insert({ name: trimmed, type })
    .select('id')
    .single();
  if (createError) throw createError;
  return { id: created.id, created: true };
}

const findEmployee: ToolDefinition = {
  name: 'find_employee',
  description:
    "Search employees in the currently open org chart by name, department (Business Unit) and/or job title (poste). Leave a field empty to not filter on it. Returns a list of matches with their id, name, job title and department.",
  parametersJsonSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Full or partial name to search for (case-insensitive).' },
      department: { type: 'string', description: 'Exact department / Business Unit name.' },
      jobTitle: { type: 'string', description: 'Exact job title / poste name.' },
    },
  },
  async run({ supabase, orgChartId, hideDepartedEmployees }, args) {
    let query = supabase
      .from('employees')
      .select('id, first_name, last_name, job_title, department')
      .eq('org_chart_id', orgChartId);
    if (typeof args.department === 'string' && args.department) {
      query = query.eq('department', args.department);
    }
    if (typeof args.jobTitle === 'string' && args.jobTitle) {
      query = query.eq('job_title', args.jobTitle);
    }
    if (hideDepartedEmployees) query = query.eq('has_left_company', false);
    const { data, error } = await query.order('last_name');
    if (error) throw error;
    const name = typeof args.name === 'string' ? args.name.trim().toLowerCase() : '';
    const rows = name
      ? (data ?? []).filter((e) => employeeLabel(e).toLowerCase().includes(name))
      : (data ?? []);
    return { count: rows.length, employees: rows };
  },
};

const getManagerChain: ToolDefinition = {
  name: 'get_manager_chain',
  description:
    'Given an employee id (from find_employee), return their full primary-management chain up to the top of the org, plus any secondary/functional (dotted-line) managers reporting directly above them.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      employeeId: { type: 'string', description: 'id of the employee, as returned by find_employee.' },
    },
    required: ['employeeId'],
  },
  async run({ supabase, orgChartId, hideDepartedEmployees }, args) {
    const employeeId = args.employeeId as string;
    const { data: relationships, error: relError } = await supabase
      .from('reporting_relationships')
      .select('employee_id, manager_id, is_primary')
      .eq('org_chart_id', orgChartId);
    if (relError) throw relError;
    let empQuery = supabase.from('employees').select('id, first_name, last_name, job_title, department').eq('org_chart_id', orgChartId);
    if (hideDepartedEmployees) empQuery = empQuery.eq('has_left_company', false);
    const { data: employees, error: empError } = await empQuery;
    if (empError) throw empError;
    const employeeById = new Map(employees?.map((e) => [e.id, e]));

    const primaryChain: unknown[] = [];
    let currentId: string | null = employeeId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const primaryRel = relationships?.find((r) => r.employee_id === currentId && r.is_primary);
      if (!primaryRel) break;
      const manager = employeeById.get(primaryRel.manager_id);
      if (!manager) break;
      primaryChain.push(manager);
      currentId = primaryRel.manager_id;
    }

    const secondaryManagerIds = relationships
      ?.filter((r) => r.employee_id === employeeId && !r.is_primary)
      .map((r) => r.manager_id);
    const secondaryManagers = (secondaryManagerIds ?? [])
      .map((id) => employeeById.get(id))
      .filter(Boolean);

    return {
      employee: employeeById.get(employeeId) ?? null,
      primaryManagerChain: primaryChain,
      secondaryManagers,
    };
  },
};

const getDirectReports: ToolDefinition = {
  name: 'get_direct_reports',
  description:
    "Given a manager's employee id, return their direct primary reports. Set includeSubtree to true to also include every report of their reports, recursively (the whole team under this manager).",
  parametersJsonSchema: {
    type: 'object',
    properties: {
      managerId: { type: 'string', description: 'id of the manager, as returned by find_employee.' },
      includeSubtree: { type: 'boolean', description: 'If true, return the whole reporting subtree, not just direct reports.' },
    },
    required: ['managerId'],
  },
  async run({ supabase, orgChartId, hideDepartedEmployees }, args) {
    const managerId = args.managerId as string;
    const includeSubtree = args.includeSubtree === true;
    const { data: relationships, error: relError } = await supabase
      .from('reporting_relationships')
      .select('employee_id, manager_id, is_primary')
      .eq('org_chart_id', orgChartId)
      .eq('is_primary', true);
    if (relError) throw relError;
    let empQuery = supabase.from('employees').select('id, first_name, last_name, job_title, department').eq('org_chart_id', orgChartId);
    if (hideDepartedEmployees) empQuery = empQuery.eq('has_left_company', false);
    const { data: employees, error: empError } = await empQuery;
    if (empError) throw empError;
    const employeeById = new Map(employees?.map((e) => [e.id, e]));

    function directReportsOf(id: string) {
      return (relationships ?? []).filter((r) => r.manager_id === id).map((r) => r.employee_id);
    }

    const collected: string[] = [];
    const queue = directReportsOf(managerId);
    while (queue.length > 0) {
      const id = queue.shift() as string;
      collected.push(id);
      if (includeSubtree) queue.push(...directReportsOf(id));
    }

    return {
      manager: employeeById.get(managerId) ?? null,
      count: collected.length,
      reports: collected.map((id) => employeeById.get(id)).filter(Boolean),
    };
  },
};

const getAssignments: ToolDefinition = {
  name: 'get_assignments',
  description:
    "Given an employee id, return their client/mission assignments with sold (%ETP vendu) and actual (%ETP réel) allocation.",
  parametersJsonSchema: {
    type: 'object',
    properties: {
      employeeId: { type: 'string', description: 'id of the employee, as returned by find_employee.' },
    },
    required: ['employeeId'],
  },
  async run({ supabase, orgChartId }, args) {
    const employeeId = args.employeeId as string;
    const { data, error } = await supabase
      .from('assignments')
      .select('etp_vendu, etp_reel, remuneration_model, clients_missions(name, type)')
      .eq('org_chart_id', orgChartId)
      .eq('employee_id', employeeId);
    if (error) throw error;
    return { count: data?.length ?? 0, assignments: data ?? [] };
  },
};

const getDepartmentStats: ToolDefinition = {
  name: 'get_department_stats',
  description:
    'Return headcount per department (Business Unit) in the currently open org chart, plus the total headcount.',
  parametersJsonSchema: { type: 'object', properties: {} },
  async run({ supabase, orgChartId, hideDepartedEmployees }) {
    let query = supabase.from('employees').select('department').eq('org_chart_id', orgChartId);
    if (hideDepartedEmployees) query = query.eq('has_left_company', false);
    const { data, error } = await query;
    if (error) throw error;
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const key = row.department ?? '(sans Business Unit)';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return {
      totalHeadcount: data?.length ?? 0,
      byDepartment: Array.from(counts.entries()).map(([department, count]) => ({ department, count })),
    };
  },
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Deliberately general rather than one narrow "by department" / "by
// manager" tool each: it accepts any team scope (a manager's subtree, or
// the whole chart) and returns the full per-employee/per-department/grand-
// total breakdown in one shot, so the same tool answers "how is team X
// allocated" and "how is the whole org allocated" without guessing which
// grouping a question needs in advance. Sums are computed here, not left to
// the model's own arithmetic over a large JSON blob — the whole reason this
// tool exists rather than having the model add up get_assignments calls
// itself is to make the numbers in a "deep analysis" answer trustworthy.
const getTeamEtpReport: ToolDefinition = {
  name: 'get_team_etp_report',
  description:
    "Compute %ETP vendu (sold) and %ETP réel (actual) totals for a team or the whole currently open org chart — per employee, per department (Business Unit), and as a grand total. All sums are computed exactly by this tool, not estimated. Use this instead of manually adding up individual get_assignments results whenever a question needs a total, an average, or a comparison across more than a couple of people (workload analysis, over/under-staffing, ETP vendu vs réel gaps, etc.). Omit managerId to cover the entire chart; pass it to scope to one manager's team.",
  parametersJsonSchema: {
    type: 'object',
    properties: {
      managerId: {
        type: 'string',
        description: 'Optional id of a manager (from find_employee) to scope the report to their team. Omit to cover every employee in the chart.',
      },
      includeSubtree: {
        type: 'boolean',
        description: "When managerId is set, whether to include the manager's whole reporting subtree (default true) or only their direct reports.",
      },
    },
  },
  async run({ supabase, orgChartId, hideDepartedEmployees }, args) {
    const managerId = typeof args.managerId === 'string' ? args.managerId : undefined;
    const includeSubtree = args.includeSubtree !== false;

    let scopeIds: string[] | null = null;
    if (managerId) {
      const { data: relationships, error: relError } = await supabase
        .from('reporting_relationships')
        .select('employee_id, manager_id')
        .eq('org_chart_id', orgChartId)
        .eq('is_primary', true);
      if (relError) throw relError;
      const directReportsOf = (id: string) =>
        (relationships ?? []).filter((r) => r.manager_id === id).map((r) => r.employee_id);
      const collected = [managerId];
      const queue = directReportsOf(managerId);
      while (queue.length > 0) {
        const id = queue.shift() as string;
        collected.push(id);
        if (includeSubtree) queue.push(...directReportsOf(id));
      }
      scopeIds = collected;
    }

    let employeesQuery = supabase
      .from('employees')
      .select('id, first_name, last_name, job_title, department')
      .eq('org_chart_id', orgChartId);
    if (scopeIds) employeesQuery = employeesQuery.in('id', scopeIds);
    if (hideDepartedEmployees) employeesQuery = employeesQuery.eq('has_left_company', false);
    const { data: employees, error: empError } = await employeesQuery;
    if (empError) throw empError;

    const employeeIds = (employees ?? []).map((e) => e.id);
    const { data: assignments, error: assignError } = await supabase
      .from('assignments')
      .select('employee_id, etp_vendu, etp_reel, clients_missions(name, type)')
      .eq('org_chart_id', orgChartId)
      .in('employee_id', employeeIds.length > 0 ? employeeIds : ['00000000-0000-0000-0000-000000000000']);
    if (assignError) throw assignError;

    const assignmentsByEmployee = new Map<string, typeof assignments>();
    for (const a of assignments ?? []) {
      const list = assignmentsByEmployee.get(a.employee_id) ?? [];
      list.push(a);
      assignmentsByEmployee.set(a.employee_id, list);
    }

    const employeeReports = (employees ?? []).map((e) => {
      const list = assignmentsByEmployee.get(e.id) ?? [];
      const etpVenduTotal = round2(list.reduce((sum, a) => sum + (a.etp_vendu ?? 0), 0));
      const etpReelTotal = round2(list.reduce((sum, a) => sum + (a.etp_reel ?? 0), 0));
      return { ...e, assignments: list, etpVenduTotal, etpReelTotal };
    });

    const byDepartmentMap = new Map<string, { department: string; headcount: number; etpVenduTotal: number; etpReelTotal: number }>();
    for (const e of employeeReports) {
      const key = e.department ?? '(sans Business Unit)';
      const agg = byDepartmentMap.get(key) ?? { department: key, headcount: 0, etpVenduTotal: 0, etpReelTotal: 0 };
      agg.headcount += 1;
      agg.etpVenduTotal = round2(agg.etpVenduTotal + e.etpVenduTotal);
      agg.etpReelTotal = round2(agg.etpReelTotal + e.etpReelTotal);
      byDepartmentMap.set(key, agg);
    }

    return {
      scope: managerId ? { managerId, includeSubtree } : 'whole_chart',
      headcount: employeeReports.length,
      employees: employeeReports,
      byDepartment: Array.from(byDepartmentMap.values()),
      grandTotal: {
        etpVenduTotal: round2(employeeReports.reduce((sum, e) => sum + e.etpVenduTotal, 0)),
        etpReelTotal: round2(employeeReports.reduce((sum, e) => sum + e.etpReelTotal, 0)),
      },
    };
  },
};

// Mirrors get_team_etp_report's "one shot, whole chart" shape but for
// structure instead of allocation: added 2026-08-02 after a real gap
// surfaced live — asked to "detect anomalies" org-wide, the model had only
// get_manager_chain (one person at a time) and get_direct_reports (one
// manager at a time) to work with, neither of which covers "who has no
// manager at all" or "who has an unusually large span of control" without
// looping a call per employee. Same reasoning as the ETP tool: give the
// model the whole graph, precomputed, rather than trusting it to chain many
// small calls (or, worse, claim the data isn't reachable at all — which is
// what actually happened before this tool existed).
const getOrgHierarchyReport: ToolDefinition = {
  name: 'get_org_hierarchy_report',
  description:
    "Return the full reporting structure of the currently open org chart in one call: every employee with their primary manager, any secondary/functional managers, and their direct-report count — plus the list of employees who have no primary manager at all (the top of the org; normally very few). Use this for any org-wide structural question — orphaned employees, unusually large or small teams, overall shape of the hierarchy — instead of calling get_manager_chain or get_direct_reports once per person.",
  parametersJsonSchema: { type: 'object', properties: {} },
  async run({ supabase, orgChartId, hideDepartedEmployees }) {
    let empQuery = supabase.from('employees').select('id, first_name, last_name, job_title, department').eq('org_chart_id', orgChartId);
    if (hideDepartedEmployees) empQuery = empQuery.eq('has_left_company', false);
    const { data: employees, error: empError } = await empQuery;
    if (empError) throw empError;

    const { data: relationships, error: relError } = await supabase
      .from('reporting_relationships')
      .select('employee_id, manager_id, is_primary')
      .eq('org_chart_id', orgChartId);
    if (relError) throw relError;

    const employeeById = new Map((employees ?? []).map((e) => [e.id, e]));
    const primaryManagerOf = new Map<string, string>();
    const secondaryManagersOf = new Map<string, string[]>();
    const directReportCount = new Map<string, number>();

    for (const r of relationships ?? []) {
      if (r.is_primary) {
        primaryManagerOf.set(r.employee_id, r.manager_id);
        directReportCount.set(r.manager_id, (directReportCount.get(r.manager_id) ?? 0) + 1);
      } else {
        const list = secondaryManagersOf.get(r.employee_id) ?? [];
        list.push(r.manager_id);
        secondaryManagersOf.set(r.employee_id, list);
      }
    }

    const nameOf = (id: string) => {
      const e = employeeById.get(id);
      return e ? employeeLabel(e) : null;
    };

    const employeeReports = (employees ?? []).map((e) => {
      const managerId = primaryManagerOf.get(e.id) ?? null;
      return {
        id: e.id,
        name: employeeLabel(e),
        jobTitle: e.job_title,
        department: e.department,
        primaryManager: managerId ? { id: managerId, name: nameOf(managerId) } : null,
        secondaryManagers: (secondaryManagersOf.get(e.id) ?? []).map((id) => ({ id, name: nameOf(id) })),
        directReportCount: directReportCount.get(e.id) ?? 0,
      };
    });

    return {
      totalHeadcount: employeeReports.length,
      employeesWithNoPrimaryManager: employeeReports.filter((e) => !e.primaryManager).map((e) => ({ id: e.id, name: e.name })),
      employees: employeeReports,
    };
  },
};

// --- Write tools (v2, 2026-07-31) ---------------------------------------
// Create + update only, deliberately no delete tool — matches the user's
// explicit request. Two consequences worth keeping in mind if this is
// extended: (1) these writes go straight to Supabase from the backend, so
// they do NOT appear in the browser's client-side undo/redo history
// (historyStore is populated only by the frontend's own action handlers) —
// a mistake made via chat has to be corrected by hand in the grid, exactly
// like the deletion this tool set deliberately doesn't offer. (2) cycle
// prevention for manager links is NOT reimplemented here — it relies on the
// same DB trigger (0003_cycle_check_function.sql) the rest of the app
// leans on as its second line of defense; a rejected write surfaces as a
// normal tool error the model relays to the user.

const createOrgChart: ToolDefinition = {
  name: 'create_org_chart',
  description:
    'Create a brand-new, empty org chart. Not scoped to the currently open chart — this adds a new chart the user can switch to afterwards via the chart selector in the app header (it appears there automatically). Use this only when the user explicitly asks to create a new/separate org chart, not when they want to add people to the one they have open.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Full name of the new org chart.' },
      shortLabel: { type: 'string', description: 'Optional short label shown in the chart selector.' },
    },
    required: ['name'],
  },
  async run({ supabase }, args) {
    const name = args.name as string;
    const shortLabel = typeof args.shortLabel === 'string' ? args.shortLabel : undefined;
    const { data, error } = await supabase
      .from('org_charts')
      .insert({ name, ...(shortLabel ? { short_label: shortLabel } : {}) })
      .select()
      .single();
    if (error) throw error;
    return { orgChart: data };
  },
};

const createEmployee: ToolDefinition = {
  name: 'create_employee',
  description:
    'Create one new employee in the currently open org chart. Optionally link them to a manager at the same time (managerId, from find_employee) — set isPrimaryManager to false only when the employee already has a primary manager and this is an additional dotted-line/functional manager. For adding several employees at once, or a whole team with reporting links between them, use create_team instead — it is far more efficient than calling this tool repeatedly.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      jobTitle: { type: 'string', description: 'Optional job title / poste.' },
      department: { type: 'string', description: 'Optional department / Business Unit name.' },
      managerId: { type: 'string', description: 'Optional id of an existing employee to set as manager.' },
      isPrimaryManager: { type: 'boolean', description: 'Defaults to true. Set false for a secondary/functional manager link.' },
    },
    required: ['firstName', 'lastName'],
  },
  async run({ supabase, orgChartId }, args) {
    await ensureCatalogEntry(supabase, 'job_titles', args.jobTitle as string | undefined);
    await ensureCatalogEntry(supabase, 'departments', args.department as string | undefined);
    const { data: employee, error } = await supabase
      .from('employees')
      .insert({
        first_name: args.firstName as string,
        last_name: args.lastName as string,
        job_title: (args.jobTitle as string) ?? null,
        department: (args.department as string) ?? null,
        org_chart_id: orgChartId,
      })
      .select()
      .single();
    if (error) throw error;

    if (typeof args.managerId === 'string' && args.managerId) {
      const isPrimary = args.isPrimaryManager !== false;
      const { error: relError } = await supabase.from('reporting_relationships').insert({
        employee_id: employee.id,
        manager_id: args.managerId,
        is_primary: isPrimary,
        org_chart_id: orgChartId,
      });
      if (relError) return { employee, managerLinkError: relError.message };
    }

    return { employee };
  },
};

const updateEmployee: ToolDefinition = {
  name: 'update_employee',
  description:
    "Update fields on an existing employee (from find_employee). Only pass the fields that should change. Does not touch reporting relationships — use set_manager for that.",
  parametersJsonSchema: {
    type: 'object',
    properties: {
      employeeId: { type: 'string' },
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      jobTitle: { type: 'string' },
      department: { type: 'string' },
    },
    required: ['employeeId'],
  },
  async run({ supabase, orgChartId }, args) {
    const employeeId = args.employeeId as string;
    const changes: Partial<{ first_name: string; last_name: string; job_title: string; department: string }> = {};
    if (typeof args.firstName === 'string') changes.first_name = args.firstName;
    if (typeof args.lastName === 'string') changes.last_name = args.lastName;
    if (typeof args.jobTitle === 'string') changes.job_title = args.jobTitle;
    if (typeof args.department === 'string') changes.department = args.department;
    if (Object.keys(changes).length === 0) return { error: 'No fields to update were provided.' };

    if (changes.job_title !== undefined) await ensureCatalogEntry(supabase, 'job_titles', changes.job_title);
    if (changes.department !== undefined) await ensureCatalogEntry(supabase, 'departments', changes.department);

    // Captured before the write, mirroring useEmployees.ts's own
    // updateEmployee (const before = employees.find(...)) — item 48 needs
    // this so the frontend can build a real undo/redo pair out of this
    // tool's result instead of only having the post-write row.
    const { data: before, error: beforeError } = await supabase
      .from('employees')
      .select('first_name, last_name, job_title, department')
      .eq('id', employeeId)
      .single();
    if (beforeError) throw beforeError;

    const { data, error } = await supabase
      .from('employees')
      .update(changes)
      .eq('id', employeeId)
      .eq('org_chart_id', orgChartId)
      .select()
      .single();
    if (error) throw error;
    return { employee: data, before };
  },
};

const setManager: ToolDefinition = {
  name: 'set_manager',
  description:
    "Set or change a reporting link between two existing employees (both from find_employee). If isPrimary is true and the employee already has a primary manager, this REASSIGNS it (same as dragging a link in the app) rather than adding a second primary. If isPrimary is false, this adds a secondary/functional (dotted-line) manager. Rejected automatically if it would create a management cycle.",
  parametersJsonSchema: {
    type: 'object',
    properties: {
      employeeId: { type: 'string' },
      managerId: { type: 'string' },
      isPrimary: { type: 'boolean', description: 'Defaults to true.' },
    },
    required: ['employeeId', 'managerId'],
  },
  async run({ supabase, orgChartId }, args) {
    const employeeId = args.employeeId as string;
    const managerId = args.managerId as string;
    const isPrimary = args.isPrimary !== false;

    if (isPrimary) {
      // manager_id read here BEFORE the update, not just `id` — item 48
      // needs the previous manager to build an undo (reassign it back),
      // which the update's own RETURNING (the row AFTER) can't provide.
      const { data: existingPrimary, error: findError } = await supabase
        .from('reporting_relationships')
        .select('id, manager_id')
        .eq('org_chart_id', orgChartId)
        .eq('employee_id', employeeId)
        .eq('is_primary', true)
        .maybeSingle();
      if (findError) throw findError;

      if (existingPrimary) {
        const { data, error } = await supabase
          .from('reporting_relationships')
          .update({ manager_id: managerId })
          .eq('id', existingPrimary.id)
          .select()
          .single();
        if (error) throw error;
        return { relationship: data, action: 'reassigned', previousManagerId: existingPrimary.manager_id };
      }
    }

    const { data, error } = await supabase
      .from('reporting_relationships')
      .insert({ employee_id: employeeId, manager_id: managerId, is_primary: isPrimary, org_chart_id: orgChartId })
      .select()
      .single();
    if (error) throw error;
    return { relationship: data, action: 'created' };
  },
};

// Backlog item 50 — the chat previously had no way to create or modify an
// assignment or a clients_missions catalog row at all (get_assignments is
// read-only). Resolves-or-creates the named client/mission the same way
// create_employee/update_employee already resolve-or-create job titles and
// departments, so the model can do this in one call rather than requiring
// the user to pre-create the client/mission via the Clients/Missions tab
// first. Deliberately upserts by (employeeId, clientMissionId) instead of
// always inserting: uq_employee_client_mission means a second assignment on
// the same client/mission would otherwise just fail with a constraint
// error — updating in place matches what re-editing the same row in
// AssignmentEditorModal would do.
const createAssignment: ToolDefinition = {
  name: 'create_assignment',
  description:
    "Create or update a client/mission assignment for an employee (from find_employee), setting their %ETP vendu (sold) and/or %ETP réel (actual) allocation. If the named client/mission doesn't already exist in the Clients/Missions catalog, it is created automatically — never ask the user to create it first. If this employee already has an assignment on this exact client/mission, this updates it in place rather than creating a duplicate. Note: a 'commission' remunerationModel can never carry an etpVendu value (DB constraint) — omit etpVendu when setting commission.",
  parametersJsonSchema: {
    type: 'object',
    properties: {
      employeeId: { type: 'string' },
      clientMissionName: { type: 'string', description: 'Name of the client or mission, new or existing.' },
      clientMissionType: {
        type: 'string',
        enum: ['client', 'mission'],
        description: 'Whether this is a client or an internal mission.',
      },
      etpVendu: { type: 'number', description: '% ETP vendu (sold), 0-100. Omit to leave unset/unchanged.' },
      etpReel: { type: 'number', description: '% ETP réel (actual), 0-100. Omit to leave unset/unchanged.' },
      remunerationModel: { type: 'string', enum: ['retainer', 'commission'], description: 'Optional remuneration model.' },
    },
    required: ['employeeId', 'clientMissionName', 'clientMissionType'],
  },
  async run({ supabase, orgChartId }, args) {
    const employeeId = args.employeeId as string;
    const clientMissionType = args.clientMissionType as 'client' | 'mission';
    const etpVendu = typeof args.etpVendu === 'number' ? args.etpVendu : undefined;
    const etpReel = typeof args.etpReel === 'number' ? args.etpReel : undefined;
    const remunerationModel = args.remunerationModel as RemunerationModel | undefined;

    const { id: clientMissionId, created: clientMissionCreated } = await findOrCreateClientMission(
      supabase,
      args.clientMissionName as string,
      clientMissionType,
    );

    // Selects the full row, not just `id` — item 48 needs the pre-update
    // etp_vendu/etp_reel/remuneration_model to build an undo, the same
    // reasoning as update_employee's own `before` select above.
    const { data: existing, error: findExistingError } = await supabase
      .from('assignments')
      .select('id, etp_vendu, etp_reel, remuneration_model')
      .eq('org_chart_id', orgChartId)
      .eq('employee_id', employeeId)
      .eq('client_mission_id', clientMissionId)
      .maybeSingle();
    if (findExistingError) throw findExistingError;

    if (existing) {
      const changes: Partial<{ etp_vendu: number; etp_reel: number; remuneration_model: RemunerationModel }> = {};
      if (etpVendu !== undefined) changes.etp_vendu = etpVendu;
      if (etpReel !== undefined) changes.etp_reel = etpReel;
      if (remunerationModel !== undefined) changes.remuneration_model = remunerationModel;
      const { data, error } = await supabase.from('assignments').update(changes).eq('id', existing.id).select().single();
      if (error) throw error;
      return {
        assignment: data,
        action: 'updated',
        clientMissionCreated,
        before: { etp_vendu: existing.etp_vendu, etp_reel: existing.etp_reel, remuneration_model: existing.remuneration_model },
      };
    }

    const { data, error } = await supabase
      .from('assignments')
      .insert({
        employee_id: employeeId,
        client_mission_id: clientMissionId,
        etp_vendu: etpVendu ?? null,
        etp_reel: etpReel ?? null,
        remuneration_model: remunerationModel ?? null,
        org_chart_id: orgChartId,
      })
      .select()
      .single();
    if (error) throw error;
    return { assignment: data, action: 'created', clientMissionCreated };
  },
};

interface BatchEmployeeInput {
  localId: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  department?: string;
  managerLocalId?: string;
  managerId?: string;
  isPrimaryManager?: boolean;
}

const createTeam: ToolDefinition = {
  name: 'create_team',
  description:
    "Create several employees in one call, optionally wiring reporting links between them — the right tool whenever the user asks for more than one new employee at once, or a whole team/org structure in a single request. Give each new employee a short localId of your own choosing (e.g. 'a', 'b', 'mgr1') to reference them as managers of each other within this same call, via managerLocalId. To report to someone who already exists in the chart, use managerId (an id from find_employee) instead of managerLocalId.",
  parametersJsonSchema: {
    type: 'object',
    properties: {
      employees: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            localId: { type: 'string', description: "Your own short reference for this person, unique within this call." },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            jobTitle: { type: 'string' },
            department: { type: 'string' },
            managerLocalId: { type: 'string', description: "Another entry's localId, if their manager is also being created in this same call." },
            managerId: { type: 'string', description: 'id of an existing employee (from find_employee), if their manager already exists in the chart.' },
            isPrimaryManager: { type: 'boolean', description: 'Defaults to true.' },
          },
          required: ['localId', 'firstName', 'lastName'],
        },
      },
    },
    required: ['employees'],
  },
  async run({ supabase, orgChartId }, args) {
    const entries = (args.employees as BatchEmployeeInput[]) ?? [];
    const localIdToRealId = new Map<string, string>();
    const created: unknown[] = [];

    for (const entry of entries) {
      await ensureCatalogEntry(supabase, 'job_titles', entry.jobTitle);
      await ensureCatalogEntry(supabase, 'departments', entry.department);
      const { data, error } = await supabase
        .from('employees')
        .insert({
          first_name: entry.firstName,
          last_name: entry.lastName,
          job_title: entry.jobTitle ?? null,
          department: entry.department ?? null,
          org_chart_id: orgChartId,
        })
        .select()
        .single();
      if (error) throw error;
      localIdToRealId.set(entry.localId, data.id);
      created.push(data);
    }

    const relationshipErrors: { localId: string; error: string }[] = [];
    for (const entry of entries) {
      const managerId = entry.managerId ?? (entry.managerLocalId ? localIdToRealId.get(entry.managerLocalId) : undefined);
      if (!managerId) continue;
      const employeeId = localIdToRealId.get(entry.localId);
      if (!employeeId) continue;
      const { error } = await supabase.from('reporting_relationships').insert({
        employee_id: employeeId,
        manager_id: managerId,
        is_primary: entry.isPrimaryManager !== false,
        org_chart_id: orgChartId,
      });
      if (error) relationshipErrors.push({ localId: entry.localId, error: error.message });
    }

    return { count: created.length, employees: created, relationshipErrors };
  },
};

// deleteEmployee/restoreEmployee are a pair, deliberately: this app has no
// server-side audit log (item 30b "change_log" is still just a backlog
// entry) and writes made from this backend never reach the browser's
// historyStore (that only records the frontend's own action handlers) — so
// a chat-driven delete has NO Ctrl+Z. Real historyStore integration for
// chat writes is backlogged for later (see project memory). Until then,
// delete_employee returns the full deleted rows (employee + every
// reporting_relationships/assignments row that cascade-deleted with it) so
// restore_employee can recreate them byte-for-byte if the user asks to undo
// in the same conversation — the model is instructed to hold onto that data
// for exactly this purpose. This is a conversation-scoped safety net, not a
// real undo: closing the chat or starting a new conversation loses it.
interface DeletedEmployeeSnapshot {
  id: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  role_desc: string | null;
  department: string | null;
  photo_path: string | null;
  photo_zoom: number;
  photo_pan_x: number;
  photo_pan_y: number;
  sibling_order: number | null;
}
interface DeletedRelationshipSnapshot {
  id: string;
  employee_id: string;
  manager_id: string;
  is_primary: boolean;
}
interface DeletedAssignmentSnapshot {
  id: string;
  employee_id: string;
  client_mission_id: string;
  etp_vendu: number | null;
  etp_reel: number | null;
  remuneration_model: string | null;
}

const deleteEmployee: ToolDefinition = {
  name: 'delete_employee',
  description:
    "Permanently delete an employee (from find_employee) from the currently open org chart, including their reporting links (as an employee and as anyone else's manager) and their client/mission assignments. Returns the full deleted data — hold onto it: if the user asks to undo this in the same conversation, call restore_employee with exactly that data. Once this conversation ends, the deletion can no longer be undone via chat.",
  parametersJsonSchema: {
    type: 'object',
    properties: {
      employeeId: { type: 'string' },
    },
    required: ['employeeId'],
  },
  async run({ supabase, orgChartId }, args) {
    const employeeId = args.employeeId as string;

    const { data: employee, error: empError } = await supabase
      .from('employees')
      .select('*')
      .eq('id', employeeId)
      .eq('org_chart_id', orgChartId)
      .single();
    if (empError) throw empError;

    const { data: relationships, error: relError } = await supabase
      .from('reporting_relationships')
      .select('*')
      .eq('org_chart_id', orgChartId)
      .or(`employee_id.eq.${employeeId},manager_id.eq.${employeeId}`);
    if (relError) throw relError;

    const { data: assignments, error: assignError } = await supabase
      .from('assignments')
      .select('*')
      .eq('org_chart_id', orgChartId)
      .eq('employee_id', employeeId);
    if (assignError) throw assignError;

    const { error: deleteError } = await supabase.from('employees').delete().eq('id', employeeId);
    if (deleteError) throw deleteError;

    return {
      deletedEmployee: employee,
      deletedRelationships: relationships ?? [],
      deletedAssignments: assignments ?? [],
    };
  },
};

const restoreEmployee: ToolDefinition = {
  name: 'restore_employee',
  description:
    'Undo a delete_employee call from earlier in this same conversation. Pass back exactly the deletedEmployee, deletedRelationships and deletedAssignments values delete_employee returned — do not alter them. Only usable while the deleted data is still in this conversation; there is no other way to recover a chat-driven deletion.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      employee: { type: 'object', description: 'The exact deletedEmployee object returned by delete_employee.' },
      relationships: { type: 'array', items: { type: 'object' }, description: 'The exact deletedRelationships array returned by delete_employee.' },
      assignments: { type: 'array', items: { type: 'object' }, description: 'The exact deletedAssignments array returned by delete_employee.' },
    },
    required: ['employee'],
  },
  async run({ supabase, orgChartId }, args) {
    const employee = args.employee as DeletedEmployeeSnapshot;
    const relationships = (args.relationships as DeletedRelationshipSnapshot[]) ?? [];
    const assignments = (args.assignments as DeletedAssignmentSnapshot[]) ?? [];

    const { error: empError } = await supabase.from('employees').insert({
      id: employee.id,
      first_name: employee.first_name,
      last_name: employee.last_name,
      job_title: employee.job_title,
      role_desc: employee.role_desc,
      department: employee.department,
      photo_path: employee.photo_path,
      photo_zoom: employee.photo_zoom,
      photo_pan_x: employee.photo_pan_x,
      photo_pan_y: employee.photo_pan_y,
      sibling_order: employee.sibling_order,
      org_chart_id: orgChartId,
    });
    if (empError) throw empError;

    const relationshipErrors: string[] = [];
    for (const rel of relationships) {
      const { error } = await supabase.from('reporting_relationships').insert({
        id: rel.id,
        employee_id: rel.employee_id,
        manager_id: rel.manager_id,
        is_primary: rel.is_primary,
        org_chart_id: orgChartId,
      });
      if (error) relationshipErrors.push(error.message);
    }

    const assignmentErrors: string[] = [];
    for (const a of assignments) {
      const { error } = await supabase.from('assignments').insert({
        id: a.id,
        employee_id: a.employee_id,
        client_mission_id: a.client_mission_id,
        etp_vendu: a.etp_vendu,
        etp_reel: a.etp_reel,
        remuneration_model: a.remuneration_model as 'retainer' | 'commission' | null,
        org_chart_id: orgChartId,
      });
      if (error) assignmentErrors.push(error.message);
    }

    return {
      restoredEmployeeId: employee.id,
      relationshipsRestored: relationships.length - relationshipErrors.length,
      assignmentsRestored: assignments.length - assignmentErrors.length,
      relationshipErrors,
      assignmentErrors,
    };
  },
};

export const chatTools: ToolDefinition[] = [
  findEmployee,
  getManagerChain,
  getDirectReports,
  getAssignments,
  getDepartmentStats,
  getTeamEtpReport,
  getOrgHierarchyReport,
  createOrgChart,
  createEmployee,
  updateEmployee,
  setManager,
  createAssignment,
  createTeam,
  deleteEmployee,
  restoreEmployee,
];

export const chatToolsByName = new Map(chatTools.map((t) => [t.name, t]));
