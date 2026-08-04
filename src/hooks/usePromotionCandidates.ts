import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as employeeService from '../services/employeeService';
import * as orgChartService from '../services/orgChartService';
import type { Employee } from '../types/domain';

export interface PromotionCandidate extends Employee {
  orgChartName: string;
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
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [employees, orgCharts, ownRegistryEmployees] = await Promise.all([
      employeeService.fetchCandidateEmployees(registryChartId, includeHidden),
      orgChartService.fetchOrgCharts(),
      employeeService.fetchEmployees(registryChartId),
    ]);
    const nameById = new Map(orgCharts.map((c) => [c.id, c.name]));
    setCandidates(employees.map((e) => ({ ...e, orgChartName: nameById.get(e.org_chart_id) ?? '—' })));
    setRegistryEmployees(ownRegistryEmployees);
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
  // identity to check more precisely (see the spec).
  const findRegistryNameMatch = useCallback(
    (employee: Employee): Employee | undefined =>
      registryEmployees.find(
        (r) =>
          r.first_name.trim().toLowerCase() === employee.first_name.trim().toLowerCase() &&
          r.last_name.trim().toLowerCase() === employee.last_name.trim().toLowerCase(),
      ),
    [registryEmployees],
  );

  const promote = useCallback(
    async (employee: Employee) => {
      await employeeService.importEmployee(registryChartId, employee);
      // Drops out of the default candidate list the same way a manually
      // masked one does — see hidden_from_registry_candidates' own comment
      // in types/domain.ts for why this is one flag, not a promoted/hidden pair.
      await employeeService.setHiddenFromRegistryCandidates(employee.id, true);
      await refresh();
    },
    [registryChartId, refresh],
  );

  const hide = useCallback(
    async (employeeId: string) => {
      await employeeService.setHiddenFromRegistryCandidates(employeeId, true);
      await refresh();
    },
    [refresh],
  );

  return { candidates, includeHidden, setIncludeHidden, loading, findRegistryNameMatch, promote, hide };
}
