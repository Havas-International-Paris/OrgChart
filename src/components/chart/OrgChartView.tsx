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
import { departmentColorMap } from '../../lib/departmentColor';
import { useSelectionStore } from '../../stores/selectionStore';
import { useVisibleGraph } from './useVisibleGraph';
import { layoutWithDagre, NODE_WIDTH, NODE_HEIGHT } from './layoutEngine';
import { EmployeeNode, type EmployeeNodeActions, type EmployeeNodeData } from './EmployeeNode';
import { LinkExistingEmployeeModal } from '../shared/LinkExistingEmployeeModal';
import { DepartmentLegend } from './DepartmentLegend';
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
  const { employees, loading: employeesLoading, createEmployee, updateEmployee } = useEmployees();
  const {
    relationships,
    loading: relationshipsLoading,
    managersOf,
    directReportsOf,
    addRelationship,
    wouldCreateCycle,
  } = useReportingGraph();
  const { assignmentsOf, totalEtpOf } = useAssignments();
  const { jobTitles } = useJobTitles();
  const jobTitleNames = useMemo(() => jobTitles.map((jt) => jt.name), [jobTitles]);
  const { departments } = useDepartments();
  const departmentNames = useMemo(() => departments.map((d) => d.name), [departments]);
  const departmentColorByName = useMemo(() => departmentColorMap(departments), [departments]);

  const expandedNodeIds = useSelectionStore((s) => s.expandedNodeIds);
  const setExpandedNodeIds = useSelectionStore((s) => s.setExpandedNodeIds);
  const toggleExpanded = useSelectionStore((s) => s.toggleExpanded);
  const selectedEmployeeId = useSelectionStore((s) => s.selectedEmployeeId);
  const setSelectedEmployee = useSelectionStore((s) => s.setSelectedEmployee);
  const searchQuery = useSelectionStore((s) => s.searchQuery);
  const expandAncestors = useSelectionStore((s) => s.expandAncestors);
  const setAssignmentsEmployeeId = useSelectionStore((s) => s.setAssignmentsEmployeeId);

  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
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

  const { visibleEmployees, childrenOf } = useVisibleGraph(employees, primaryEdges, expandedNodeIds);

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

  const { nodes, edges } = useMemo(() => {
    const visibleIds = new Set(visibleEmployees.map((e) => e.id));

    const rawNodes: Node<EmployeeNodeData>[] = visibleEmployees.map((employee) => ({
      id: employee.id,
      type: 'employee',
      position: { x: 0, y: 0 },
      data: {
        employee,
        hasChildren: (childrenOf.get(employee.id)?.length ?? 0) > 0,
        isExpanded: expandedNodeIds.has(employee.id),
        isSelected: employee.id === selectedEmployeeId,
        isMatch: matchedIds.has(employee.id),
        assignmentsCount: assignmentsOf(employee.id).length,
        assignmentsTotalEtp: totalEtpOf(employee.id),
        jobTitles: jobTitleNames,
        departmentNames,
        departmentColor: employee.department
          ? (departmentColorByName.get(employee.department) ?? null)
          : null,
        onToggleExpand: toggleExpanded,
        actions,
      },
    }));

    const visiblePrimaryEdges: Edge[] = primaryEdges
      .filter((r) => visibleIds.has(r.employee_id) && visibleIds.has(r.manager_id))
      .map((r) => ({
        id: r.id,
        source: r.manager_id,
        target: r.employee_id,
      }));

    const layoutedNodes = layoutWithDagre(rawNodes, visiblePrimaryEdges);

    const visibleSecondaryEdges: Edge[] = secondaryEdges
      .filter((r) => visibleIds.has(r.employee_id) && visibleIds.has(r.manager_id))
      .map((r) => ({
        id: r.id,
        source: r.manager_id,
        target: r.employee_id,
        style: { strokeDasharray: '6 4' },
      }));

    return { nodes: layoutedNodes, edges: [...visiblePrimaryEdges, ...visibleSecondaryEdges] };
  }, [
    visibleEmployees,
    childrenOf,
    expandedNodeIds,
    selectedEmployeeId,
    matchedIds,
    primaryEdges,
    secondaryEdges,
    toggleExpanded,
    actions,
    assignmentsOf,
    totalEtpOf,
    jobTitleNames,
    departmentNames,
    departmentColorByName,
  ]);

  // Center on the selected node once it's laid out and visible.
  useEffect(() => {
    if (!selectedEmployeeId || !reactFlowInstanceRef.current) return;
    const node = nodes.find((n) => n.id === selectedEmployeeId);
    if (!node) return;
    reactFlowInstanceRef.current.setCenter(
      node.position.x + NODE_WIDTH / 2,
      node.position.y + NODE_HEIGHT / 2,
      { zoom: 1, duration: 400 },
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
      <DepartmentLegend departments={departments} colorByName={departmentColorByName} />
      <ReactFlow
        nodeTypes={nodeTypes}
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={0.1}
        onInit={(instance) => {
          reactFlowInstanceRef.current = instance;
        }}
        onNodeClick={(_, node) => setSelectedEmployee(node.id)}
        onPaneClick={() => setSelectedEmployee(null)}
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
      {linkModalProps && (
        <LinkExistingEmployeeModal
          title={linkModalProps.title}
          candidates={linkModalProps.candidates}
          isDisabled={linkModalProps.isDisabled}
          onLink={linkModalProps.onLink}
          onClose={() => setLinkModal(null)}
        />
      )}
    </div>
  );
}
