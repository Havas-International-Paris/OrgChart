import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Panel,
  type Edge,
  type Node,
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
import { departmentColorMap } from '../../lib/departmentColor';
import { useSelectionStore } from '../../stores/selectionStore';
import { useVisibleGraph } from './useVisibleGraph';
import { useReportingChain } from './useReportingChain';
import { layoutWithDagre, NODE_WIDTH, NODE_HEIGHT } from './layoutEngine';
import { EmployeeNode, type EmployeeNodeActions, type EmployeeNodeData } from './EmployeeNode';
import { LinkExistingEmployeeModal } from '../shared/LinkExistingEmployeeModal';
import { PhotoEditorModal } from '../shared/PhotoEditorModal';
import { DepartmentLegend } from './DepartmentLegend';
import { EmployeeDetailPanel } from './EmployeeDetailPanel';
import { exportChartAsPng } from './exportChartImage';

const nodeTypes = { employee: EmployeeNode };

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
    updateEmployeePhoto,
    updateEmployeePhotoFrame,
  } = useEmployees(currentOrgChartId);
  const { replacePhoto, saveFrame, deletePhoto } = usePhotoActions(employees, updateEmployeePhoto, updateEmployeePhotoFrame);
  const [photoEditEmployeeId, setPhotoEditEmployeeId] = useState<string | null>(null);
  const {
    relationships,
    loading: relationshipsLoading,
    managersOf,
    directReportsOf,
    addRelationship,
    wouldCreateCycle,
  } = useReportingGraph(currentOrgChartId);
  const { assignmentsOf, totalEtpOf, totalEtpReelOf } = useAssignments(currentOrgChartId);
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
    if (focusedNodeIds.size === 0) return visibleEmployees;

    const visibleIds = new Set(visibleEmployees.map((e) => e.id));
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

    return visibleEmployees.filter((e) => keep.has(e.id));
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

  const quickAddManager = useCallback(
    async (employeeId: string) => {
      const hasPrimary = managersOf(employeeId).some((r) => r.is_primary);
      const created = await createEmployee({ first_name: 'Nouveau', last_name: 'Manager' });
      await addRelationship(employeeId, created.id, !hasPrimary);
      setSelectedEmployee(created.id);
    },
    [managersOf, createEmployee, addRelationship, setSelectedEmployee],
  );

  const quickAddSubordinate = useCallback(
    async (employeeId: string) => {
      const created = await createEmployee({ first_name: 'Nouveau', last_name: 'Collaborateur' });
      await addRelationship(created.id, employeeId, true);
      setSelectedEmployee(created.id);
    },
    [createEmployee, addRelationship, setSelectedEmployee],
  );

  const openLinkManager = useCallback(
    (employeeId: string) => setLinkModal({ employeeId, direction: 'manager' }),
    [],
  );
  const openLinkSubordinate = useCallback(
    (employeeId: string) => setLinkModal({ employeeId, direction: 'subordinate' }),
    [],
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
    }),
    [
      quickAddManager,
      quickAddSubordinate,
      openLinkManager,
      openLinkSubordinate,
      setAssignmentsEmployeeId,
      updateEmployee,
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
    const laidOut = layoutWithDagre(rawNodes, primaryEdgeAll);
    return new Map(laidOut.map((n) => [n.id, n]));
  }, [employees, primaryEdges]);

  const { nodes, edges } = useMemo(() => {
    const visibleIds = new Set(finalVisibleEmployees.map((e) => e.id));

    const primaryEdgeBase = primaryEdges
      .filter((r) => visibleIds.has(r.employee_id) && visibleIds.has(r.manager_id))
      .map((r) => ({ id: r.id, source: r.manager_id, target: r.employee_id }));

    const secondaryEdgeBase = secondaryEdges
      .filter((r) => visibleIds.has(r.employee_id) && visibleIds.has(r.manager_id))
      .map((r) => ({ id: r.id, source: r.manager_id, target: r.employee_id }));

    const nodes: Node<EmployeeNodeData>[] = finalVisibleEmployees.flatMap((employee) => {
      const baseNode = layoutedNodeById.get(employee.id);
      if (!baseNode) return [];

      const directReportsCount = childrenOf.get(employee.id)?.length ?? 0;
      const advertiserNames = assignmentsOf(employee.id)
        .map((a) => clientMissionNameById.get(a.client_mission_id))
        .filter((name): name is string => Boolean(name));

      return [
        {
          ...baseNode,
          data: {
            employee,
            hasChildren: directReportsCount > 0,
            isExpanded: expandedNodeIds.has(employee.id),
            isSelected: employee.id === selectedEmployeeId,
            isMatch: matchedIds.has(employee.id),
            isDimmed:
              (deptFilter !== null && employee.department !== deptFilter) ||
              (activeEmployeeId !== null && !relatedIds.has(employee.id)),
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
    // ends sit inside the ancestor/descendant chain.
    const edgeHighlight = (managerId: string, employeeId: string): 'highlighted' | 'dimmed' | 'normal' => {
      if (!activeEmployeeId) return 'normal';
      if (activeEmployeeId === managerId || activeEmployeeId === employeeId) return 'highlighted';
      if (chainIds.has(managerId) && chainIds.has(employeeId)) return 'highlighted';
      return 'dimmed';
    };

    const styledPrimaryEdges: Edge[] = primaryEdgeBase.map((e) => {
      const state = edgeHighlight(e.source, e.target);
      return {
        ...e,
        style:
          state === 'highlighted'
            ? { stroke: '#0f172a', strokeWidth: 2.5 }
            : state === 'dimmed'
              ? { opacity: 0.08 }
              : undefined,
      };
    });

    const styledSecondaryEdges: Edge[] = secondaryEdgeBase.map((e) => {
      const state = edgeHighlight(e.source, e.target);
      return {
        ...e,
        style:
          state === 'highlighted'
            ? { stroke: '#0f172a', strokeWidth: 2.5, strokeDasharray: '2 4' }
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
    jobTitleNames,
    departmentNames,
    departmentColorByName,
  ]);

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
    if (expandedNodeIds.size === 0 || nodes.length === 0) return;
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
  }, [employeesLoading, relationshipsLoading, expandedNodeIds, nodes]);

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
    const node = nodes.find((n) => n.id === selectedEmployeeId);
    if (!node) return;
    lastCenteredIdRef.current = selectedEmployeeId;
    reactFlowInstanceRef.current.setCenter(
      node.position.x + NODE_WIDTH / 2,
      node.position.y + NODE_HEIGHT / 2,
      { zoom: reactFlowInstanceRef.current.getZoom(), duration: 400 },
    );
  }, [selectedEmployeeId, nodes]);

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
      // mounted), not the local `nodes` array — that one only carries the
      // dagre layout's approximate NODE_WIDTH/NODE_HEIGHT, which under-counts
      // actual card size and clips the rightmost/bottommost nodes.
      const measuredNodes = reactFlowInstanceRef.current?.getNodes() ?? nodes;
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
        nodes={nodes}
        edges={edges}
        minZoom={0.1}
        onInit={(instance) => {
          reactFlowInstanceRef.current = instance;
        }}
        onNodeClick={(_, node) => setSelectedEmployee(node.id)}
        onPaneClick={() => setSelectedEmployee(null)}
        onNodeMouseEnter={(_, node) => setHoverEmployeeId(node.id)}
        onNodeMouseLeave={() => setHoverEmployeeId(null)}
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
