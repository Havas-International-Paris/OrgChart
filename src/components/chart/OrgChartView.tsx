import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Panel,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useEmployees } from '../../hooks/useEmployees';
import { useReportingGraph } from '../../hooks/useReportingGraph';
import { useAssignments } from '../../hooks/useAssignments';
import { useJobTitles } from '../../hooks/useJobTitles';
import { useDepartments } from '../../hooks/useDepartments';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { usePhotoActions } from '../../hooks/usePhotoActions';
import { useEmployeeDeletion } from '../../hooks/useEmployeeDeletion';
import { UndoRedoButtons } from '../shared/UndoRedoButtons';
import { departmentColorMap, NEUTRAL_DEPARTMENT_COLOR } from '../../lib/departmentColor';
import { useSelectionStore } from '../../stores/selectionStore';
import { useHistoryStore, withSuppressedRecording } from '../../stores/historyStore';
import { createIdBox } from '../../lib/history/idBox';
import { registerIdBox } from '../../stores/idRegistryStore';
import { useVisibleGraph } from './useVisibleGraph';
import { useReportingChain } from './useReportingChain';
import { layoutWithDagre, NODE_WIDTH, NODE_HEIGHT } from './layoutEngine';
import { ROOT_GROUP_KEY } from './siblingOrder';
import {
  computeReorder,
  findDisplacementTargets,
  type ChartGeometry,
} from './siblingReorderGeometry';
import { EmployeeNode, type EmployeeNodeActions, type EmployeeNodeData } from './EmployeeNode';
import { ReportingEdge, type ReportingEdgeData } from './ReportingEdge';
import { LinkExistingEmployeeModal } from '../shared/LinkExistingEmployeeModal';
import { PhotoEditorModal } from '../shared/PhotoEditorModal';
import { DepartmentLegend } from './DepartmentLegend';
import { EmployeeDetailPanel } from './EmployeeDetailPanel';
import { exportChartAsPng } from './exportChartImage';
import type { Employee, ReportingRelationship } from '../../types/domain';

const nodeTypes = { employee: EmployeeNode };
const edgeTypes = { reporting: ReportingEdge };

// Above this headcount, default to roots + one level instead of fully
// expanded — see the effect below for why.
const FULL_EXPAND_THRESHOLD = 30;

interface LinkModalState {
  employeeId: string;
  direction: 'manager' | 'subordinate';
}

export function OrgChartView() {
  const currentOrgChartId = useSelectionStore((s) => s.currentOrgChartId);
  const {
    employees,
    loading: employeesLoading,
    createEmployee,
    updateEmployee,
    deleteEmployee,
    updateEmployeePhoto,
    updateEmployeePhotoFrame,
    updateSiblingOrders,
  } = useEmployees(currentOrgChartId);
  const { replacePhoto, saveFrame, deletePhoto } = usePhotoActions(employees, updateEmployeePhoto, updateEmployeePhotoFrame);
  const [photoEditEmployeeId, setPhotoEditEmployeeId] = useState<string | null>(null);
  const {
    relationships,
    loading: relationshipsLoading,
    managersOf,
    directReportsOf,
    addRelationship,
    removeRelationship,
    reassignManager,
    wouldCreateCycle,
  } = useReportingGraph(currentOrgChartId);
  const { assignments, assignmentsOf, totalEtpOf, totalEtpReelOf, createAssignment } =
    useAssignments(currentOrgChartId);
  const { jobTitles } = useJobTitles();
  const jobTitleNames = useMemo(() => jobTitles.map((jt) => jt.name), [jobTitles]);
  const { departments } = useDepartments();
  const departmentNames = useMemo(() => departments.map((d) => d.name), [departments]);
  const departmentColorByName = useMemo(() => departmentColorMap(departments), [departments]);
  const { clientsMissions } = useClientsMissions();
  const clientMissionNameById = useMemo(
    () => new Map(clientsMissions.map((cm) => [cm.id, cm.name])),
    [clientsMissions],
  );

  const [deptFilter, setDeptFilter] = useState<string | null>(null);
  const toggleDeptFilter = useCallback(
    (name: string) => setDeptFilter((current) => (current === name ? null : name)),
    [],
  );
  const departmentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of employees) {
      if (!e.department) continue;
      counts.set(e.department, (counts.get(e.department) ?? 0) + 1);
    }
    return counts;
  }, [employees]);

  const clientMissionFilterIds = useSelectionStore((s) => s.clientMissionFilterIds);
  // null = filter inactive (everyone matches); otherwise the set of
  // employees with at least one assignment to a selected client/mission.
  const matchingEmployeeIds = useMemo(() => {
    if (clientMissionFilterIds.size === 0) return null;
    const ids = new Set<string>();
    for (const a of assignments) {
      if (clientMissionFilterIds.has(a.client_mission_id)) ids.add(a.employee_id);
    }
    return ids;
  }, [assignments, clientMissionFilterIds]);

  const expandedNodeIds = useSelectionStore((s) => s.expandedNodeIds);
  const setExpandedNodeIds = useSelectionStore((s) => s.setExpandedNodeIds);
  const toggleExpanded = useSelectionStore((s) => s.toggleExpanded);
  const focusedNodeIds = useSelectionStore((s) => s.focusedNodeIds);
  const toggleFocused = useSelectionStore((s) => s.toggleFocused);
  const selectedEmployeeId = useSelectionStore((s) => s.selectedEmployeeId);
  const setSelectedEmployee = useSelectionStore((s) => s.setSelectedEmployee);
  const searchQuery = useSelectionStore((s) => s.searchQuery);
  const expandAncestors = useSelectionStore((s) => s.expandAncestors);
  const setAssignmentsEmployeeId = useSelectionStore((s) => s.setAssignmentsEmployeeId);

  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  // Whether the initial auto-fit has run for the currently-loaded chart —
  // see the effect below for why this can't just be the `fitView` prop.
  const hasAutoFitRef = useRef(false);
  // Which employee we last recentered the view on — see the "Center on the
  // selected node" effect below for why this can't just be a `nodes` dep.
  const lastCenteredIdRef = useRef<string | null>(null);
  const [linkModal, setLinkModal] = useState<LinkModalState | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const primaryEdges = useMemo(() => relationships.filter((r) => r.is_primary), [relationships]);
  const secondaryEdges = useMemo(() => relationships.filter((r) => !r.is_primary), [relationships]);

  const primaryManagerOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const edge of primaryEdges) map.set(edge.employee_id, edge.manager_id);
    return map;
  }, [primaryEdges]);
  const getPrimaryManagerId = useCallback(
    (employeeId: string) => primaryManagerOf.get(employeeId) ?? null,
    [primaryManagerOf],
  );

  const matchedIds = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return new Set<string>();
    return new Set(
      employees
        .filter((e) => `${e.first_name} ${e.last_name}`.toLowerCase().includes(query))
        .map((e) => e.id),
    );
  }, [employees, searchQuery]);

  const { visibleEmployees, childrenOf, totalDescendantCountOf } = useVisibleGraph(
    employees,
    primaryEdges,
    expandedNodeIds,
  );

  // Focus mode ("isolate me + my team") is a filter layered on top of the
  // normal expand/collapse visibility above, not a replacement for it — it
  // only ever hides *already-visible* people, never force-reveals a
  // collapsed subtree. Walking `childrenOf` (the full tree) but only
  // recursing into ids already in `visibleEmployees` is what keeps that
  // true. Multiple people can be focused at once (a Set), in which case
  // everyone kept is the union of each focused person's own subtree.
  const finalVisibleEmployees = useMemo(() => {
    let result = visibleEmployees;

    if (focusedNodeIds.size > 0) {
      const visibleIds = new Set(result.map((e) => e.id));
      const keep = new Set<string>();
      const addWithVisibleDescendants = (id: string) => {
        if (keep.has(id)) return;
        keep.add(id);
        for (const childId of childrenOf.get(id) ?? []) {
          if (visibleIds.has(childId)) addWithVisibleDescendants(childId);
        }
      };
      for (const id of focusedNodeIds) {
        if (visibleIds.has(id)) addWithVisibleDescendants(id);
      }
      result = result.filter((e) => keep.has(e.id));
    }

    return result;
  }, [visibleEmployees, focusedNodeIds, childrenOf]);

  // Global count shown on every active focus badge ("+N masqués") — matches
  // the design spec, which counts everyone hidden across the whole chart by
  // focus mode, not just this one person's own hidden ancestors.
  const focusHiddenCount = employees.length - finalVisibleEmployees.length;

  // Hovering highlights the reporting chain the same way pinning (clicking)
  // a card does; hover takes priority while active, falling back to the
  // pinned selection once the mouse leaves — un-hovering never clears a
  // pin, matching the design spec.
  const [hoverEmployeeId, setHoverEmployeeId] = useState<string | null>(null);
  // Set while a ReportingEdge grip drag is in progress — see the
  // onNodeMouseEnter/Leave handlers on <ReactFlow> below for why hover
  // updates must be suppressed during a drag. A ref, not state: it only
  // gates a synchronous check inside those handlers and never needs to
  // trigger a render itself — using state here left a real race, since a
  // node crossed in the same tick as the grip's mousedown could still read
  // the pre-update value before React's batched setState had flushed.
  const isReassigningEdgeRef = useRef(false);
  // Which reporting-relationship edge (if any) has its delete/grip controls
  // open — click-to-select, not hover, so it persists until deselected (a
  // different link, a node, the pane, or clicking the same link again).
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const activeEmployeeId = hoverEmployeeId ?? selectedEmployeeId;
  const { relatedIds, chainIds } = useReportingChain(activeEmployeeId, relationships, childrenOf);

  // Default expand state once employees AND relationships have both finished
  // their initial load: fully expanded for small teams (nothing to gain by
  // hiding anything), but only roots + one level for large orgs, where
  // expanding everything makes the auto-layout too large to fit the canvas
  // even at minimum zoom. Must wait for relationships too, not just
  // employees — computing this from a still-empty primaryEdges list treats
  // every employee as a root and produces a much larger default set than
  // intended.
  useEffect(() => {
    if (employeesLoading || relationshipsLoading) return;
    if (employees.length === 0 || expandedNodeIds.size > 0) return;

    if (employees.length <= FULL_EXPAND_THRESHOLD) {
      setExpandedNodeIds(new Set(employees.map((e) => e.id)));
      return;
    }

    // Marking only the roots as expanded reveals exactly one level below
    // them (roots are always visible; expanding a node reveals its direct
    // children). Also marking that first level as expanded would cascade
    // into revealing a second level, and so on.
    const hasPrimaryManager = new Set(primaryEdges.map((e) => e.employee_id));
    const roots = employees.filter((e) => !hasPrimaryManager.has(e.id)).map((e) => e.id);
    setExpandedNodeIds(new Set(roots));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeesLoading, relationshipsLoading, employees.length]);

  // Reveal and center whichever employee is selected (from grid or chart).
  useEffect(() => {
    if (!selectedEmployeeId) return;
    expandAncestors(selectedEmployeeId, getPrimaryManagerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmployeeId, getPrimaryManagerId]);

  // Auto-reveal search matches too.
  useEffect(() => {
    for (const id of matchedIds) expandAncestors(id, getPrimaryManagerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedIds, getPrimaryManagerId]);

  // Create-employee + add-relationship is one user action ("quick add a
  // manager/subordinate"), so it must record as a single undo/redo command,
  // not two separate ones from createEmployee's and addRelationship's own
  // per-mutator recording. withSuppressedRecording mutes those while the two
  // raw calls run below; the id box (idBox.ts) is what lets a later,
  // independent edit of the newly-created employee (e.g. renaming them in
  // the grid) keep working after this command's own undo/redo recreates
  // them under a fresh id.
  const quickAddManager = useCallback(
    async (employeeId: string) => {
      const hasPrimary = managersOf(employeeId).some((r) => r.is_primary);
      const isPrimary = !hasPrimary;
      let created!: Employee;
      await withSuppressedRecording(async () => {
        created = await createEmployee({ first_name: 'Nouveau', last_name: 'Manager' });
        await addRelationship(employeeId, created.id, isPrimary);
      });
      setSelectedEmployee(created.id);

      if (currentOrgChartId) {
        const managerIdBox = createIdBox(created.id);
        registerIdBox(created.id, managerIdBox);
        useHistoryStore.getState().push({
          label: 'Ajouter un manager',
          orgChartId: currentOrgChartId,
          // Deleting the employee cascades (FK) the relationship row too.
          undo: async () => { await deleteEmployee(managerIdBox.id); },
          redo: () =>
            withSuppressedRecording(async () => {
              const recreated = await createEmployee({ first_name: 'Nouveau', last_name: 'Manager' });
              managerIdBox.id = recreated.id;
              registerIdBox(recreated.id, managerIdBox);
              await addRelationship(employeeId, recreated.id, isPrimary);
            }),
        });
      }
    },
    [managersOf, createEmployee, addRelationship, deleteEmployee, setSelectedEmployee, currentOrgChartId],
  );

  const quickAddSubordinate = useCallback(
    async (employeeId: string) => {
      let created!: Employee;
      await withSuppressedRecording(async () => {
        created = await createEmployee({ first_name: 'Nouveau', last_name: 'Collaborateur' });
        await addRelationship(created.id, employeeId, true);
      });
      setSelectedEmployee(created.id);

      if (currentOrgChartId) {
        const reportIdBox = createIdBox(created.id);
        registerIdBox(created.id, reportIdBox);
        useHistoryStore.getState().push({
          label: 'Ajouter un subordonné',
          orgChartId: currentOrgChartId,
          undo: async () => { await deleteEmployee(reportIdBox.id); },
          redo: () =>
            withSuppressedRecording(async () => {
              const recreated = await createEmployee({ first_name: 'Nouveau', last_name: 'Collaborateur' });
              reportIdBox.id = recreated.id;
              registerIdBox(recreated.id, reportIdBox);
              await addRelationship(recreated.id, employeeId, true);
            }),
        });
      }
    },
    [createEmployee, addRelationship, deleteEmployee, setSelectedEmployee, currentOrgChartId],
  );

  const openLinkManager = useCallback(
    (employeeId: string) => setLinkModal({ employeeId, direction: 'manager' }),
    [],
  );
  const openLinkSubordinate = useCallback(
    (employeeId: string) => setLinkModal({ employeeId, direction: 'subordinate' }),
    [],
  );

  const deleteEmployeeWithHistory = useEmployeeDeletion(
    currentOrgChartId,
    { employees, createEmployee, deleteEmployee },
    { relationships, addRelationship },
    { assignments, createAssignment },
  );

  const handleDeleteEmployee = useCallback(
    async (employeeId: string) => {
      await deleteEmployeeWithHistory(employeeId);
      // Avoid leaving the detail panel / assignments modal pointed at a
      // record that no longer exists.
      if (selectedEmployeeId === employeeId) setSelectedEmployee(null);
    },
    [deleteEmployeeWithHistory, selectedEmployeeId, setSelectedEmployee],
  );

  const handleDeleteRelationship = useCallback(
    (relationship: ReportingRelationship) => {
      removeRelationship(relationship);
      setSelectedEdgeId(null);
    },
    [removeRelationship],
  );

  // Shared by the live drag-hover feedback and the drop itself, so a drop
  // can never succeed on a target the hover pass would have rejected.
  const computeDropValidity = useCallback(
    (employeeId: string, targetId: string): 'valid' | 'invalid' => {
      if (targetId === employeeId) return 'invalid';
      // Covers dropping back on the current manager too — a no-op, not an
      // error, but still routed through "invalid" so it's simply ignored.
      if (managersOf(employeeId).some((m) => m.manager_id === targetId)) return 'invalid';
      if (wouldCreateCycle(employeeId, targetId)) return 'invalid';
      return 'valid';
    },
    [managersOf, wouldCreateCycle],
  );

  const handleReassignManager = useCallback(
    (relationship: ReportingRelationship, newManagerId: string) => {
      if (computeDropValidity(relationship.employee_id, newManagerId) !== 'valid') return;
      reassignManager(relationship, newManagerId);
      setSelectedEdgeId(null);
    },
    [computeDropValidity, reassignManager],
  );

  const actions = useMemo<EmployeeNodeActions>(
    () => ({
      quickAddManager,
      quickAddSubordinate,
      openLinkManager,
      openLinkSubordinate,
      openAssignments: setAssignmentsEmployeeId,
      updateEmployee,
      openPhotoEditor: setPhotoEditEmployeeId,
      deleteEmployee: handleDeleteEmployee,
    }),
    [
      quickAddManager,
      quickAddSubordinate,
      openLinkManager,
      openLinkSubordinate,
      setAssignmentsEmployeeId,
      updateEmployee,
      handleDeleteEmployee,
    ],
  );

  const linkModalProps = useMemo(() => {
    if (!linkModal) return null;
    const { employeeId, direction } = linkModal;
    const currentEmployee = employeeById.get(employeeId);
    if (!currentEmployee) return null;
    const currentLabel = `${currentEmployee.first_name} ${currentEmployee.last_name}`;

    if (direction === 'manager') {
      const existingManagerIds = new Set(managersOf(employeeId).map((r) => r.manager_id));
      return {
        title: `Ajouter un manager à ${currentLabel}`,
        candidates: employees.filter((e) => e.id !== employeeId && !existingManagerIds.has(e.id)),
        isDisabled: (candidateId: string) => wouldCreateCycle(employeeId, candidateId),
        onLink: async (candidateId: string) => {
          const hasPrimary = managersOf(employeeId).some((r) => r.is_primary);
          await addRelationship(employeeId, candidateId, !hasPrimary);
        },
      };
    }

    const existingReportIds = new Set(directReportsOf(employeeId).map((r) => r.employee_id));
    return {
      title: `Ajouter un subordonné à ${currentLabel}`,
      candidates: employees.filter((e) => e.id !== employeeId && !existingReportIds.has(e.id)),
      isDisabled: (candidateId: string) => wouldCreateCycle(candidateId, employeeId),
      onLink: async (candidateId: string) => {
        const hasPrimary = managersOf(candidateId).some((r) => r.is_primary);
        await addRelationship(candidateId, employeeId, !hasPrimary);
      },
    };
  }, [linkModal, employeeById, employees, managersOf, directReportsOf, wouldCreateCycle, addRelationship]);

  const detailPanelProps = useMemo(() => {
    if (!selectedEmployeeId) return null;
    const employee = employeeById.get(selectedEmployeeId);
    if (!employee) return null;

    const managerRelations = managersOf(selectedEmployeeId);
    const primaryManagerId = managerRelations.find((r) => r.is_primary)?.manager_id;
    const manager = primaryManagerId ? (employeeById.get(primaryManagerId) ?? null) : null;
    const functionalManagers = managerRelations
      .filter((r) => !r.is_primary)
      .map((r) => employeeById.get(r.manager_id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));

    const reportRelations = directReportsOf(selectedEmployeeId);
    const directReports = reportRelations
      .filter((r) => r.is_primary)
      .map((r) => employeeById.get(r.employee_id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
    const functionalReports = reportRelations
      .filter((r) => !r.is_primary)
      .map((r) => employeeById.get(r.employee_id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));

    return {
      employee,
      departmentColor: employee.department ? (departmentColorByName.get(employee.department) ?? null) : null,
      manager,
      functionalManagers,
      directReports,
      functionalReports,
    };
  }, [selectedEmployeeId, employeeById, managersOf, directReportsOf, departmentColorByName]);

  // Dagre lays out the *entire* org chart, every employee, regardless of
  // what's currently expanded/collapsed/focused — never just the visible
  // subset. Collapsing a team, isolating someone via focus mode, or
  // hovering (dimming) must never shift anyone's position on screen; dagre
  // isn't a stable/incremental layout, so re-running it on a smaller or
  // larger node set reflows *everyone*, not just the nodes that
  // appeared/disappeared. Laying out the full tree once and then simply
  // filtering which nodes/edges get rendered (below) keeps every visible
  // card's position fixed no matter how the visible subset changes. This
  // also means dagre only re-runs when employees or primary reporting
  // edges actually change — not on hover, selection, search, the dept
  // filter, or any visibility toggle — which is what stops rapid hovering
  // from stuttering (see the earlier fix for that).
  const layoutedNodeById = useMemo(() => {
    const rawNodes: Node[] = employees.map((employee) => ({
      id: employee.id,
      type: 'employee',
      position: { x: 0, y: 0 },
      data: null,
    }));
    const primaryEdgeAll = primaryEdges.map((r) => ({ id: r.id, source: r.manager_id, target: r.employee_id }));
    const laidOut = layoutWithDagre(rawNodes, primaryEdgeAll, (id) => employeeById.get(id)?.sibling_order ?? null);
    return new Map(laidOut.map((n) => [n.id, n]));
  }, [employees, primaryEdges, employeeById]);

  // The chart's current geometry, as the plain lookups siblingReorderGeometry.ts
  // works from. Shared by the drop handler and the live mid-drag feedback so the
  // two can never disagree about whether a position is inside the cluster.
  const reorderGeometry = useMemo<ChartGeometry>(
    () => ({
      allIds: employees.map((e) => e.id),
      groupKeyOf: (id) => primaryManagerOf.get(id) ?? ROOT_GROUP_KEY,
      visibleIds: new Set(finalVisibleEmployees.map((e) => e.id)),
      baseXOf: (id) => layoutedNodeById.get(id)?.position.x ?? 0,
      childrenOf: (id) => childrenOf.get(id) ?? [],
      siblingOrderOf: (id) => employeeById.get(id)?.sibling_order ?? null,
    }),
    [employees, primaryManagerOf, finalVisibleEmployees, layoutedNodeById, childrenOf, employeeById],
  );

  // Drag-to-reorder among same-manager siblings ONLY — never a re-parent
  // (that's ReportingEdge.tsx's grip drag). All the geometry lives in
  // siblingReorderGeometry.ts (and is unit-tested there); this is just the glue
  // that turns its decision into either a snap-back or a persisted reorder.
  const handleNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      // The drag itself is over the instant this fires — resume the
      // computedNodes→flowNodes sync (and hover tracking) now, regardless
      // of whether the resulting mutation below is still in flight, and
      // clear the live "who's about to be displaced" highlight.
      isDraggingRef.current = false;
      setDisplacementTargetIds(new Set());

      const outcome = computeReorder(reorderGeometry, node.id, node.position.x);

      if (outcome.kind === 'snap-back') {
        // No mutation runs, so nothing forces computedNodes to a new reference
        // and flowNodes would otherwise keep the dropped (wrong) position for
        // this node indefinitely. Reset it directly in the array we control.
        const committed = layoutedNodeById.get(node.id);
        if (!committed) return;
        setFlowNodes((nds) =>
          nds.map((n) => (n.id === node.id ? { ...n, position: committed.position } : n)),
        );
        return;
      }

      const employee = employeeById.get(node.id);
      const label = employee ? `Réordonner ${employee.first_name} ${employee.last_name}` : 'Réordonner';
      updateSiblingOrders(outcome.updates, label);
    },
    [reorderGeometry, layoutedNodeById, employeeById, updateSiblingOrders],
  );

  const { nodes: computedNodes, edges } = useMemo(() => {
    const visibleIds = new Set(finalVisibleEmployees.map((e) => e.id));

    const primaryEdgeBase = primaryEdges
      .filter((r) => visibleIds.has(r.employee_id) && visibleIds.has(r.manager_id))
      .map((r) => ({ id: r.id, source: r.manager_id, target: r.employee_id, relationship: r }));

    const secondaryEdgeBase = secondaryEdges
      .filter((r) => visibleIds.has(r.employee_id) && visibleIds.has(r.manager_id))
      .map((r) => ({ id: r.id, source: r.manager_id, target: r.employee_id, relationship: r }));

    const nodes: Node<EmployeeNodeData>[] = finalVisibleEmployees.flatMap((employee) => {
      const baseNode = layoutedNodeById.get(employee.id);
      if (!baseNode) return [];

      const directReportsCount = childrenOf.get(employee.id)?.length ?? 0;
      const advertiserNames = assignmentsOf(employee.id)
        .map((a) => clientMissionNameById.get(a.client_mission_id))
        .filter((name): name is string => Boolean(name));
      const isDimmed =
        (deptFilter !== null && employee.department !== deptFilter) ||
        (matchingEmployeeIds !== null && !matchingEmployeeIds.has(employee.id)) ||
        (activeEmployeeId !== null && !relatedIds.has(employee.id));

      return [
        {
          ...baseNode,
          data: {
            employee,
            hasChildren: directReportsCount > 0,
            isExpanded: expandedNodeIds.has(employee.id),
            isSelected: employee.id === selectedEmployeeId,
            isMatch: matchedIds.has(employee.id),
            isDimmed,
            // Gated on !isDimmed so a card can never be both glowing and
            // faded at once (isDimmed also factors in the separate
            // department-legend filter, which is independent of the active
            // hover chain) — see the plan's note on this interaction.
            isChainHighlighted: !isDimmed && activeEmployeeId !== null && relatedIds.has(employee.id),
            // Static default here — this memo must NOT depend on drag-
            // transient state (it's the expensive per-render styling pass
            // over every visible employee). The real, live value is merged
            // in separately via the lightweight `renderedNodes` derivation
            // below, the same way flowNodes overrides live drag position.
            isDisplacementTarget: false,
            assignmentsCount: assignmentsOf(employee.id).length,
            assignmentsTotalEtpVendu: totalEtpOf(employee.id),
            assignmentsTotalEtpReel: totalEtpReelOf(employee.id),
            advertiserNames,
            directReportsCount,
            totalDescendantCount: totalDescendantCountOf(employee.id),
            functionalManagerCount: managersOf(employee.id).filter((r) => !r.is_primary).length,
            hasManager: primaryManagerOf.has(employee.id),
            isFocused: focusedNodeIds.has(employee.id),
            focusHiddenCount,
            jobTitles: jobTitleNames,
            departmentNames,
            departmentColor: employee.department
              ? (departmentColorByName.get(employee.department) ?? null)
              : null,
            onToggleExpand: toggleExpanded,
            onToggleFocus: toggleFocused,
            actions,
          },
        },
      ];
    });

    // An edge is part of the highlighted chain if it touches the active
    // person directly (covers incoming-dotted reporters, whose edge
    // wouldn't otherwise qualify — see useReportingChain), or if both its
    // ends sit inside the ancestor/descendant chain. The edge currently
    // selected for editing (delete/drag controls open) is always
    // highlighted too, regardless of any hover/pin chain — the user needs
    // to see at a glance which relationship they're about to change.
    const edgeHighlight = (
      managerId: string,
      employeeId: string,
      relationshipId: string,
    ): 'highlighted' | 'dimmed' | 'normal' => {
      if (relationshipId === selectedEdgeId) return 'highlighted';
      if (!activeEmployeeId) return 'normal';
      if (activeEmployeeId === managerId || activeEmployeeId === employeeId) return 'highlighted';
      if (chainIds.has(managerId) && chainIds.has(employeeId)) return 'highlighted';
      return 'dimmed';
    };

    // The highlighted color for an edge is always the SUBORDINATE's (the
    // employee/target end's) department color, never the manager's — this
    // is what makes a chain crossing departments visibly switch color at
    // the point where the subordinate side changes. Mirrors EmployeeNode's
    // own `swatch` fallback exactly.
    const subordinateColor = (employeeId: string): string => {
      const department = employeeById.get(employeeId)?.department;
      return (department ? departmentColorByName.get(department) : null) ?? NEUTRAL_DEPARTMENT_COLOR;
    };

    const edgeData = (relationship: ReportingRelationship): ReportingEdgeData => ({
      onDelete: () => handleDeleteRelationship(relationship),
      onReassignHover: (targetId) => computeDropValidity(relationship.employee_id, targetId),
      onReassignDrop: (targetId) => handleReassignManager(relationship, targetId),
      onDragStateChange: (dragging) => {
        isReassigningEdgeRef.current = dragging;
      },
      isPrimary: relationship.is_primary,
      isSelected: relationship.id === selectedEdgeId,
      onSelect: () => setSelectedEdgeId((cur) => (cur === relationship.id ? null : relationship.id)),
    });

    const styledPrimaryEdges: Edge<ReportingEdgeData>[] = primaryEdgeBase.map(({ relationship, ...e }) => {
      const state = edgeHighlight(e.source, e.target, relationship.id);
      return {
        ...e,
        type: 'reporting',
        data: edgeData(relationship),
        style:
          state === 'highlighted'
            ? { stroke: subordinateColor(e.target), strokeWidth: 2.5 }
            : state === 'dimmed'
              ? { opacity: 0.08 }
              : undefined,
      };
    });

    const styledSecondaryEdges: Edge<ReportingEdgeData>[] = secondaryEdgeBase.map(({ relationship, ...e }) => {
      const state = edgeHighlight(e.source, e.target, relationship.id);
      return {
        ...e,
        type: 'reporting',
        data: edgeData(relationship),
        style:
          state === 'highlighted'
            ? { stroke: subordinateColor(e.target), strokeWidth: 2.5, strokeDasharray: '2 4' }
            : state === 'dimmed'
              ? { opacity: 0.08, strokeDasharray: '6 4' }
              : { strokeDasharray: '6 4' },
      };
    });

    return { nodes, edges: [...styledPrimaryEdges, ...styledSecondaryEdges] };
  }, [
    finalVisibleEmployees,
    layoutedNodeById,
    primaryEdges,
    secondaryEdges,
    employeeById,
    childrenOf,
    expandedNodeIds,
    selectedEmployeeId,
    activeEmployeeId,
    relatedIds,
    chainIds,
    matchedIds,
    toggleExpanded,
    toggleFocused,
    primaryManagerOf,
    focusedNodeIds,
    focusHiddenCount,
    actions,
    assignmentsOf,
    totalEtpOf,
    totalEtpReelOf,
    totalDescendantCountOf,
    managersOf,
    clientMissionNameById,
    deptFilter,
    matchingEmployeeIds,
    jobTitleNames,
    departmentNames,
    departmentColorByName,
    handleDeleteRelationship,
    computeDropValidity,
    handleReassignManager,
    selectedEdgeId,
  ]);

  // React Flow only renders a node's position from its OWN internal store
  // during a live drag if that node is under "controlled" management (a
  // `nodes` prop paired with `onNodesChange`) — otherwise the drag ends up
  // computing a final position (which is all `onNodeDragStop` needs) without
  // ever visibly tracking the cursor. `flowNodes` is the controlled array
  // React Flow actually renders; `computedNodes` (above) is kept as the
  // single source of truth and re-synced into it whenever it legitimately
  // changes (real data, hover/selection-driven dimming, etc.) — safe to do
  // via a plain effect now that every one of computedNodes's dependencies is
  // properly memoized (see useEmployees.ts/useReportingGraph.ts's useCallback
  // wrapping), so this effect fires only on real changes, not every render —
  // an earlier attempt at this same pattern, before that stabilization
  // existed, looped infinitely for exactly that reason.
  //
  // `isDraggingRef` additionally skips this sync WHILE a drag is in flight:
  // dragging one node moves the cursor over OTHER cards too, firing their
  // onNodeMouseEnter/Leave — which changes hoverEmployeeId, which legitimately
  // recomputes computedNodes (the hover/chain-highlight dimming depends on
  // it) — and without this guard, every such recompute would overwrite the
  // in-progress drag's live position with the last-committed one, fighting
  // the drag update every time the cursor crosses another card (visible as
  // flicker, worse the longer/more cards a drag crosses). Syncing resumes
  // the instant the drag stops, so the eventual post-mutation layout still
  // takes over normally.
  const [flowNodes, setFlowNodes] = useState<Node[]>([]);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    if (isDraggingRef.current) return;
    setFlowNodes(computedNodes);
  }, [computedNodes]);

  // Live drag-only feedback: while dragging, whichever sibling (+ their
  // descendants) is nearest the dragged card's current x is who's about to
  // be displaced if dropped here — the same geometry handleNodeDragStop
  // uses to decide the actual reorder, just run continuously and only ever
  // reading positions, never writing. Kept as its OWN small piece of state
  // rather than folded into flowNodes/computedNodes so recomputing it on
  // every drag frame stays cheap (no dagre re-layout, no full styling pass).
  const [displacementTargetIds, setDisplacementTargetIds] = useState<Set<string>>(new Set());

  const renderedNodes = useMemo(() => {
    if (displacementTargetIds.size === 0) return flowNodes;
    return flowNodes.map((n) =>
      displacementTargetIds.has(n.id) !== Boolean((n.data as EmployeeNodeData | null)?.isDisplacementTarget)
        ? { ...n, data: { ...n.data, isDisplacementTarget: displacementTargetIds.has(n.id) } }
        : n,
    );
  }, [flowNodes, displacementTargetIds]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setFlowNodes((nds) => applyNodeChanges(changes, nds));

      // Recomputed on every drag frame, so it must stay cheap: no dagre
      // re-layout, no styling pass, only position reads (see
      // findDisplacementTargets). A batch carrying several position changes
      // ends on the last one, same as before.
      for (const change of changes) {
        if (change.type !== 'position' || !change.position) continue;
        setDisplacementTargetIds(
          findDisplacementTargets(reorderGeometry, change.id, change.position.x),
        );
      }
    },
    [reorderGeometry],
  );

  const handleNodeDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  // Re-arm the auto-fit whenever the user switches to a different chart —
  // otherwise the view would stay wherever it was left on the previous
  // chart's (unrelated) node layout.
  useEffect(() => {
    hasAutoFitRef.current = false;
  }, [currentOrgChartId]);

  // Fit the view once, the first time real data is on screen. `<ReactFlow
  // fitView>` only fits on ReactFlow's own mount, which in practice happens
  // immediately — before employees/relationships have finished their async
  // load — so it was fitting an empty (or stale, pre-expand) node set and
  // never refitting once the real data arrived. Doing it imperatively here,
  // gated on both loading flags and the default-expand effect above having
  // already populated expandedNodeIds, waits for the node set React Flow
  // will actually render. The two rAF waits mirror the same "let the
  // re-render paint before touching the DOM" trick used in handleExport
  // below, giving React Flow's ResizeObserver a tick to measure the newly
  // mounted cards before fitView reads their real width/height.
  useEffect(() => {
    if (hasAutoFitRef.current) return;
    if (employeesLoading || relationshipsLoading) return;
    if (expandedNodeIds.size === 0 || computedNodes.length === 0) return;
    const instance = reactFlowInstanceRef.current;
    if (!instance) return;

    hasAutoFitRef.current = true;
    let cancelled = false;
    (async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      if (!cancelled) instance.fitView({ padding: 0.08 });
    })();
    return () => {
      cancelled = true;
    };
  }, [employeesLoading, relationshipsLoading, expandedNodeIds, computedNodes]);

  // Pan to the selected node once it's laid out and visible, without
  // changing the user's current zoom level (React Flow's setCenter zooms to
  // `maxZoom` if `zoom` is omitted, not the current zoom — has to be passed
  // explicitly via getZoom()). Re-centers at most once per selection,
  // tracked via lastCenteredIdRef rather than just reacting to
  // `selectedEmployeeId` changing — `nodes` is a dependency too (a
  // freshly-created node isn't laid out yet on the same render that selects
  // it, so this needs to retry once dagre positions it), but `nodes` also
  // gets a new reference whenever the team-collapse or focus/isolate badge
  // changes the visible set, or hover dims other cards. The ref guard is
  // what keeps those from re-centering: toggling a badge on an
  // already-selected card doesn't change `selectedEmployeeId`, so it still
  // matches `lastCenteredIdRef.current` and the effect no-ops — only an
  // actual change of *who* is selected re-centers.
  useEffect(() => {
    if (!selectedEmployeeId) {
      lastCenteredIdRef.current = null;
      return;
    }
    if (lastCenteredIdRef.current === selectedEmployeeId || !reactFlowInstanceRef.current) return;
    const node = computedNodes.find((n) => n.id === selectedEmployeeId);
    if (!node) return;
    lastCenteredIdRef.current = selectedEmployeeId;
    reactFlowInstanceRef.current.setCenter(
      node.position.x + NODE_WIDTH / 2,
      node.position.y + NODE_HEIGHT / 2,
      { zoom: reactFlowInstanceRef.current.getZoom(), duration: 400 },
    );
  }, [selectedEmployeeId, computedNodes]);

  if (!employeesLoading && !relationshipsLoading && employees.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Aucun employé pour le moment — ajoutez-en un dans le tableur.
      </div>
    );
  }

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      // Let the "Export…" state paint before capturing — calling toPng
      // synchronously right after setExporting races React's re-render and
      // produces a blank image (html-to-image reads the DOM mid-flight).
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const date = new Date().toISOString().slice(0, 10);
      // Use the live instance's nodes (auto-measured width/height once
      // mounted), not the local `flowNodes` array — that one only carries
      // the dagre layout's approximate NODE_WIDTH/NODE_HEIGHT, which
      // under-counts actual card size and clips the rightmost/bottommost
      // nodes.
      const measuredNodes = reactFlowInstanceRef.current?.getNodes() ?? renderedNodes;
      await exportChartAsPng(measuredNodes, `organigramme_${date}.png`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="relative h-full w-full">
      <DepartmentLegend
        departments={departments}
        colorByName={departmentColorByName}
        counts={departmentCounts}
        activeFilter={deptFilter}
        onToggle={toggleDeptFilter}
      />
      <ReactFlow
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodes={renderedNodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        minZoom={0.1}
        nodesDraggable
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onInit={(instance) => {
          reactFlowInstanceRef.current = instance;
        }}
        onNodeClick={(_, node) => {
          setSelectedEmployee(node.id);
          setSelectedEdgeId(null);
        }}
        onPaneClick={() => {
          setSelectedEmployee(null);
          setSelectedEdgeId(null);
        }}
        onNodeMouseEnter={(_, node) => {
          if (!isReassigningEdgeRef.current && !isDraggingRef.current) setHoverEmployeeId(node.id);
        }}
        onNodeMouseLeave={() => {
          if (!isReassigningEdgeRef.current && !isDraggingRef.current) setHoverEmployeeId(null);
        }}
      >
        <Panel position="top-right" className="flex flex-col items-end gap-1">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {exporting ? 'Export…' : 'Exporter en image'}
          </button>
          {exportError && (
            <p className="max-w-[220px] rounded bg-red-50 px-2 py-1 text-right text-xs text-red-600">
              {exportError}
            </p>
          )}
        </Panel>
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
      {/* Positioned to clear React Flow's own bottom-left zoom/fit-view
          controls (a plain absolutely-positioned div, not a react-flow
          Panel, since Controls isn't itself a Panel and won't stack with
          one automatically). */}
      <div className="absolute bottom-2.5 left-14 z-10">
        <UndoRedoButtons />
      </div>
      {detailPanelProps && (
        <EmployeeDetailPanel
          employee={detailPanelProps.employee}
          departmentColor={detailPanelProps.departmentColor}
          manager={detailPanelProps.manager}
          functionalManagers={detailPanelProps.functionalManagers}
          directReports={detailPanelProps.directReports}
          functionalReports={detailPanelProps.functionalReports}
          onClose={() => setSelectedEmployee(null)}
          onSelectEmployee={setSelectedEmployee}
        />
      )}
      {linkModalProps && (
        <LinkExistingEmployeeModal
          title={linkModalProps.title}
          candidates={linkModalProps.candidates}
          isDisabled={linkModalProps.isDisabled}
          onLink={linkModalProps.onLink}
          onClose={() => setLinkModal(null)}
        />
      )}
      {photoEditEmployeeId &&
        (() => {
          const photoEmployee = employeeById.get(photoEditEmployeeId);
          if (!photoEmployee) return null;
          return (
            <PhotoEditorModal
              employeeName={`${photoEmployee.first_name} ${photoEmployee.last_name}`}
              photoPath={photoEmployee.photo_path}
              currentFrame={{
                zoom: photoEmployee.photo_zoom,
                panX: photoEmployee.photo_pan_x,
                panY: photoEmployee.photo_pan_y,
              }}
              onSave={async (file, frame) => {
                if (file) await replacePhoto(photoEmployee.id, file);
                await saveFrame(photoEmployee.id, frame);
              }}
              onDelete={() => deletePhoto(photoEmployee.id)}
              onClose={() => setPhotoEditEmployeeId(null)}
            />
          );
        })()}
    </div>
  );
}
