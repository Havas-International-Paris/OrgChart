import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as employeeService from '../services/employeeService';
import * as orgChartService from '../services/orgChartService';
import * as reportingService from '../services/reportingService';
import * as assignmentService from '../services/assignmentService';
import type { Employee, ReportingRelationship, Assignment } from '../types/domain';

export interface PromotionCandidate extends Employee {
  orgChartName: string;
}

function sameName(a: Employee, b: Employee): boolean {
  return (
    a.first_name.trim().toLowerCase() === b.first_name.trim().toLowerCase() &&
    a.last_name.trim().toLowerCase() === b.last_name.trim().toLowerCase()
  );
}

// Backlog item 58 Phase B ("Salariés à promouvoir"). Owns both halves of
// flux 2: the candidate list (every employee outside the registry, minus
// whichever `includeHidden` currently filters out) and the registry's own
// employees (kept alongside, purely for the name-dedup check at promote
// time — never rendered).
export function usePromotionCandidates(registryChartId: string) {
  const [includeHidden, setIncludeHidden] = useState(false);
  const [candidates, setCandidates] = useState<PromotionCandidate[]>([]);
  const [registryEmployees, setRegistryEmployees] = useState<Employee[]>([]);
  // Every employee/relationship/assignment OUTSIDE the registry, regardless
  // of hidden_from_registry_candidates — needed to resolve a promoted
  // employee's manager and assignments even when that manager is itself
  // already hidden (already promoted earlier). Unlike `candidates` above,
  // never filtered and never rendered directly.
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [allRelationships, setAllRelationships] = useState<ReportingRelationship[]>([]);
  const [allAssignments, setAllAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [employees, orgCharts, ownRegistryEmployees, everyoneElse, relationships, assignments] = await Promise.all([
      employeeService.fetchCandidateEmployees(registryChartId, includeHidden),
      orgChartService.fetchOrgCharts(),
      employeeService.fetchEmployees(registryChartId),
      employeeService.fetchCandidateEmployees(registryChartId, true),
      reportingService.fetchRelationshipsAcrossCharts(registryChartId),
      assignmentService.fetchAssignmentsAcrossCharts(registryChartId),
    ]);
    const nameById = new Map(orgCharts.map((c) => [c.id, c.name]));
    setCandidates(employees.map((e) => ({ ...e, orgChartName: nameById.get(e.org_chart_id) ?? '—' })));
    setRegistryEmployees(ownRegistryEmployees);
    setAllEmployees(everyoneElse);
    setAllRelationships(relationships);
    setAllAssignments(assignments);
    setLoading(false);
  }, [registryChartId, includeHidden]);

  useEffect(() => {
    refresh();
    // Unfiltered, matching CLAUDE.md's documented reasoning for employees'
    // other realtime subscriptions — a non-PK filter (org_chart_id, or here
    // "any chart but this one") would silently drop DELETE events under
    // Postgres' default replica identity.
    const channel = supabase
      .channel(`promotion-candidates-changes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  // Name-only match, non-blocking — there's no stable cross-chart employee
  // identity to check more precisely (see the spec). Used only for the
  // dedup warning shown before promoting — returns the FIRST match
  // (whether or not it's unique) since the warning just needs to know
  // "does at least one exist", unlike findUniqueRegistryMatch below, which
  // manager-linking uses and which deliberately refuses an ambiguous match.
  const findRegistryNameMatch = useCallback(
    (employee: Employee): Employee | undefined => registryEmployees.find((r) => sameName(r, employee)),
    [registryEmployees],
  );

  const findUniqueRegistryMatch = useCallback(
    (employee: Employee): Employee | undefined => {
      const matches = registryEmployees.filter((r) => sameName(r, employee));
      return matches.length === 1 ? matches[0] : undefined;
    },
    [registryEmployees],
  );

  const findPrimaryManager = useCallback(
    (employeeId: string): Employee | undefined => {
      const rel = allRelationships.find((r) => r.employee_id === employeeId && r.is_primary);
      if (!rel) return undefined;
      return allEmployees.find((e) => e.id === rel.manager_id);
    },
    [allRelationships, allEmployees],
  );

  const importAssignments = useCallback(
    async (sourceEmployeeId: string, newEmployeeId: string) => {
      const sourceAssignments = allAssignments.filter((a) => a.employee_id === sourceEmployeeId);
      for (const a of sourceAssignments) {
        // client_mission_id is copied as-is, never remapped: clients_missions
        // is a global catalog shared by every chart including the registry
        // (see duplicate_org_chart's own identical reasoning) — nothing to
        // create or look up there.
        await assignmentService.createAssignment(
          registryChartId,
          newEmployeeId,
          a.client_mission_id,
          a.etp_vendu,
          a.etp_reel,
          a.remuneration_model,
        );
      }
    },
    [registryChartId, allAssignments],
  );

  const promote = useCallback(
    async (employee: Employee) => {
      const created = await employeeService.importEmployee(registryChartId, employee);
      // Drops out of the default candidate list the same way a manually
      // masked one does — see hidden_from_registry_candidates' own comment
      // in types/domain.ts for why this is one flag, not a promoted/hidden pair.
      await employeeService.setHiddenFromRegistryCandidates(employee.id, true);

      // Link to the manager only when the match is UNAMBIGUOUS (exactly one
      // same-name registry employee) — a wrong guess would be worse than no
      // link at all, and there's no stable cross-chart identity to verify
      // it more precisely than name.
      const sourceManager = findPrimaryManager(employee.id);
      if (sourceManager) {
        const registryManager = findUniqueRegistryMatch(sourceManager);
        if (registryManager) {
          await reportingService.createRelationship(registryChartId, created.id, registryManager.id, true);
        }
      }

      await importAssignments(employee.id, created.id);
      await refresh();
    },
    [registryChartId, refresh, findPrimaryManager, findUniqueRegistryMatch, importAssignments],
  );

  // Bulk variant for the "promote selected" button. Employees are all
  // imported first (building an old-id -> new-registry-employee map), THEN
  // relationships are linked — a manager who is ALSO in the same batch
  // resolves through that map by exact id, which is unambiguous by
  // construction and takes priority over the name-based registry match
  // promote() uses alone (falls back to it when the manager isn't in the
  // batch). No per-row dedup confirmation here (impractical for a batch) —
  // PromotionCandidatesTab surfaces one combined warning up front instead.
  const promoteMany = useCallback(
    async (employees: Employee[]) => {
      const created = await Promise.all(
        employees.map(async (employee) => [employee.id, await employeeService.importEmployee(registryChartId, employee)] as const),
      );
      const newByOldId = new Map(created);

      await Promise.all(employees.map((e) => employeeService.setHiddenFromRegistryCandidates(e.id, true)));

      for (const employee of employees) {
        const newEmployee = newByOldId.get(employee.id)!;
        const rel = allRelationships.find((r) => r.employee_id === employee.id && r.is_primary);
        if (!rel) continue;

        const batchManager = newByOldId.get(rel.manager_id);
        if (batchManager) {
          await reportingService.createRelationship(registryChartId, newEmployee.id, batchManager.id, true);
          continue;
        }

        const sourceManager = allEmployees.find((e) => e.id === rel.manager_id);
        if (!sourceManager) continue;
        const registryManager = findUniqueRegistryMatch(sourceManager);
        if (registryManager) {
          await reportingService.createRelationship(registryChartId, newEmployee.id, registryManager.id, true);
        }
      }

      for (const employee of employees) {
        const newEmployee = newByOldId.get(employee.id)!;
        await importAssignments(employee.id, newEmployee.id);
      }

      await refresh();
    },
    [registryChartId, refresh, allRelationships, allEmployees, findUniqueRegistryMatch, importAssignments],
  );

  const hide = useCallback(
    async (employeeId: string) => {
      await employeeService.setHiddenFromRegistryCandidates(employeeId, true);
      await refresh();
    },
    [refresh],
  );

  return {
    candidates,
    includeHidden,
    setIncludeHidden,
    loading,
    findRegistryNameMatch,
    promote,
    promoteMany,
    hide,
  };
}
