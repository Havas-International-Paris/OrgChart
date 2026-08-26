import { useMemo } from 'react';
import { useEmployees } from '../../hooks/useEmployees';
import { useReportingGraph } from '../../hooks/useReportingGraph';
import { useAssignments } from '../../hooks/useAssignments';
import { useJobTitles } from '../../hooks/useJobTitles';
import { useDepartments } from '../../hooks/useDepartments';
import { useCompanies } from '../../hooks/useCompanies';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { departmentColorMap } from '../../lib/departmentColor';
import { companyColorMap } from '../../lib/companyColor';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUiPreferencesStore } from '../../stores/uiPreferencesStore';

// Every dataset the chart reads, plus the lookups derived from them. Split out
// of OrgChartView so that file stops opening with forty destructured names
// before any actual chart logic appears.
//
// Everything returned is memoized, and that is load-bearing rather than
// tidiness: the node array is built from these, and an unstable reference here
// makes it churn on every render, which breaks React Flow's live drag tracking
// (see useEmployees.ts's own note on the same trap).
//
// Deliberately destructured field by field instead of spreading the three data
// hooks: all three return a `loading` and an `error`, so spreading would let the
// last one silently win for both.
export function useChartData(orgChartId: string | null) {
  const {
    employees: allEmployees,
    loading: employeesLoading,
    createEmployee,
    restoreEmployee,
    updateEmployee,
    deleteEmployee,
    updateEmployeePhoto,
    updateEmployeePhotoFrame,
    updateHasLeftCompany,
    updateSiblingOrders,
  } = useEmployees(orgChartId);

  const {
    relationships: allRelationships,
    loading: relationshipsLoading,
    managersOf,
    directReportsOf,
    addRelationship,
    restoreRelationship,
    removeRelationship,
    reassignManager,
    wouldCreateCycle,
  } = useReportingGraph(orgChartId);

  // A departed employee (and every relationship touching them) is fully
  // excluded from the chart's own graph right here, at the single source
  // every downstream hook reads from (useChartVisibility's tree walk,
  // useChartNodes' elk layout and edge construction) — not by dimming, per
  // the user's explicit choice. This is deliberately a full-relayout-style
  // input change (same code path already proven safe by switching org
  // charts), not incremental node removal mid-session, which is the
  // exotic path this app's layout engine has a documented history of
  // subtle bugs around. A still-active employee whose only primary manager
  // is hidden this way simply becomes a root (no special-case code needed:
  // root detection is just "no primary edge as employee_id" against
  // whatever's left) — they are NOT auto-reparented to the departed
  // manager's own manager, a deliberate simplification. The underlying
  // reporting_relationships rows are never touched — purely a display-time
  // filter, fully reversible by unchecking the preference.
  const hideDepartedEmployees = useUiPreferencesStore((s) => s.hideDepartedEmployees);
  const employees = useMemo(
    () => (hideDepartedEmployees ? allEmployees.filter((e) => !e.has_left_company) : allEmployees),
    [allEmployees, hideDepartedEmployees],
  );
  const relationships = useMemo(() => {
    if (!hideDepartedEmployees) return allRelationships;
    const visibleIds = new Set(employees.map((e) => e.id));
    return allRelationships.filter((r) => visibleIds.has(r.employee_id) && visibleIds.has(r.manager_id));
  }, [allRelationships, employees, hideDepartedEmployees]);

  const { assignments, assignmentsOf, totalEtpOf, totalEtpReelOf, createAssignment, restoreAssignment } =
    useAssignments(orgChartId);

  const { jobTitles } = useJobTitles();
  const { departments } = useDepartments();
  const { companies } = useCompanies();
  const { clientsMissions } = useClientsMissions();

  const jobTitleNames = useMemo(() => jobTitles.map((jt) => jt.name), [jobTitles]);
  const departmentNames = useMemo(() => departments.map((d) => d.name), [departments]);
  const departmentColorByName = useMemo(() => departmentColorMap(departments), [departments]);
  const companyColorByName = useMemo(() => companyColorMap(companies), [companies]);
  const clientMissionNameById = useMemo(
    () => new Map(clientsMissions.map((cm) => [cm.id, cm.name])),
    [clientsMissions],
  );

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const primaryEdges = useMemo(() => relationships.filter((r) => r.is_primary), [relationships]);
  const secondaryEdges = useMemo(() => relationships.filter((r) => !r.is_primary), [relationships]);

  const primaryManagerOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const edge of primaryEdges) map.set(edge.employee_id, edge.manager_id);
    return map;
  }, [primaryEdges]);

  const getPrimaryManagerId = useMemo(
    () => (employeeId: string) => primaryManagerOf.get(employeeId) ?? null,
    [primaryManagerOf],
  );

  const departmentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of employees) {
      if (!e.department) continue;
      counts.set(e.department, (counts.get(e.department) ?? 0) + 1);
    }
    return counts;
  }, [employees]);

  const companyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of employees) {
      if (!e.company) continue;
      counts.set(e.company, (counts.get(e.company) ?? 0) + 1);
    }
    return counts;
  }, [employees]);

  // Which employees match the active client/mission filter. null (not an empty
  // set) means the filter is off and everyone matches — the distinction matters,
  // since an empty set would dim the whole chart.
  const clientMissionFilterIds = useSelectionStore((s) => s.clientMissionFilterIds);
  const matchingEmployeeIds = useMemo(() => {
    if (clientMissionFilterIds.size === 0) return null;
    const ids = new Set<string>();
    for (const a of assignments) {
      if (clientMissionFilterIds.has(a.client_mission_id)) ids.add(a.employee_id);
    }
    return ids;
  }, [assignments, clientMissionFilterIds]);

  return {
    employees,
    employeesLoading,
    createEmployee,
    restoreEmployee,
    updateEmployee,
    deleteEmployee,
    updateEmployeePhoto,
    updateEmployeePhotoFrame,
    updateHasLeftCompany,
    updateSiblingOrders,

    relationships,
    relationshipsLoading,
    managersOf,
    directReportsOf,
    addRelationship,
    restoreRelationship,
    removeRelationship,
    reassignManager,
    wouldCreateCycle,

    assignments,
    assignmentsOf,
    totalEtpOf,
    totalEtpReelOf,
    createAssignment,
    restoreAssignment,

    departments,
    companies,
    jobTitleNames,
    departmentNames,
    departmentColorByName,
    departmentCounts,
    companyColorByName,
    companyCounts,
    clientMissionNameById,

    employeeById,
    primaryEdges,
    secondaryEdges,
    primaryManagerOf,
    getPrimaryManagerId,
    matchingEmployeeIds,
  };
}

export type ChartData = ReturnType<typeof useChartData>;
