import { useCallback, useState } from 'react';
import ReactFlow, { Background, Controls, MiniMap, Panel } from 'reactflow';
import 'reactflow/dist/style.css';
import { useSelectionStore } from '../../stores/selectionStore';
import { UndoRedoButtons } from '../shared/UndoRedoButtons';
import { LinkExistingEmployeeModal } from '../shared/LinkExistingEmployeeModal';
import { PhotoEditorModal } from '../shared/PhotoEditorModal';
import { EmployeeNode } from './EmployeeNode';
import { ReportingEdge } from './ReportingEdge';
import { DepartmentLegend } from './DepartmentLegend';
import { EmployeeDetailPanel } from './EmployeeDetailPanel';
import { exportChartAsPng } from './exportChartImage';
import { useChartData } from './useChartData';
import { useChartVisibility } from './useChartVisibility';
import { useChartActions } from './useChartActions';
import { useChartNodes } from './useChartNodes';
import { useChartViewport } from './useChartViewport';

const nodeTypes = { employee: EmployeeNode };
const edgeTypes = { reporting: ReportingEdge };

// Composition only. Each concern lives in its own hook, in dependency order:
//   useChartData       — the datasets and every lookup derived from them
//   useChartVisibility — who is on screen (expand/collapse, then focus mode)
//   useChartActions    — what the user can do, and the UI state those open
//   useChartNodes      — layout, node/edge arrays, live drag, hover
//   useChartViewport   — default expansion, auto-fit, panning to a selection
export function OrgChartView() {
  const currentOrgChartId = useSelectionStore((s) => s.currentOrgChartId);
  const selectedEmployeeId = useSelectionStore((s) => s.selectedEmployeeId);
  const setSelectedEmployee = useSelectionStore((s) => s.setSelectedEmployee);

  // Department-legend filter — the only piece of chart state that is neither
  // shared with the grid (selectionStore) nor owned by one of the hooks below.
  const [deptFilter, setDeptFilter] = useState<string | null>(null);
  const toggleDeptFilter = useCallback(
    (name: string) => setDeptFilter((current) => (current === name ? null : name)),
    [],
  );

  const data = useChartData(currentOrgChartId);
  const visibility = useChartVisibility(data.employees, data.primaryEdges);
  const actions = useChartActions(currentOrgChartId, data);
  const nodes = useChartNodes({ data, visibility, actions, deptFilter });
  const { reactFlowInstanceRef } = useChartViewport({
    currentOrgChartId,
    employees: data.employees,
    employeesLoading: data.employeesLoading,
    relationshipsLoading: data.relationshipsLoading,
    primaryEdges: data.primaryEdges,
    computedNodes: nodes.computedNodes,
    matchedIds: visibility.matchedIds,
    expandedNodeIds: visibility.expandedNodeIds,
    selectedEmployeeId,
    getPrimaryManagerId: data.getPrimaryManagerId,
  });

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

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
      // mounted), not the local rendered array — that one only carries the
      // dagre layout's approximate NODE_WIDTH/NODE_HEIGHT, which under-counts
      // actual card size and clips the rightmost/bottommost nodes.
      const measuredNodes = reactFlowInstanceRef.current?.getNodes() ?? nodes.renderedNodes;
      await exportChartAsPng(measuredNodes, `organigramme_${date}.png`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  if (!data.employeesLoading && !data.relationshipsLoading && data.employees.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Aucun employé pour le moment — ajoutez-en un dans le tableur.
      </div>
    );
  }

  const photoEmployee = actions.photoEditEmployeeId
    ? (data.employeeById.get(actions.photoEditEmployeeId) ?? null)
    : null;

  return (
    <div className="relative h-full w-full">
      <DepartmentLegend
        departments={data.departments}
        colorByName={data.departmentColorByName}
        counts={data.departmentCounts}
        activeFilter={deptFilter}
        onToggle={toggleDeptFilter}
      />
      <ReactFlow
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodes={nodes.renderedNodes}
        edges={nodes.edges}
        onNodesChange={nodes.handleNodesChange}
        minZoom={0.1}
        nodesDraggable
        onNodeDragStart={nodes.handleNodeDragStart}
        onNodeDragStop={nodes.handleNodeDragStop}
        onInit={(instance) => {
          reactFlowInstanceRef.current = instance;
        }}
        onNodeClick={(_, node) => {
          setSelectedEmployee(node.id);
          actions.setSelectedEdgeId(null);
        }}
        onPaneClick={() => {
          setSelectedEmployee(null);
          actions.setSelectedEdgeId(null);
        }}
        onNodeMouseEnter={nodes.handleNodeMouseEnter}
        onNodeMouseLeave={nodes.handleNodeMouseLeave}
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
      {actions.detailPanelProps && (
        <EmployeeDetailPanel
          employee={actions.detailPanelProps.employee}
          departmentColor={actions.detailPanelProps.departmentColor}
          manager={actions.detailPanelProps.manager}
          functionalManagers={actions.detailPanelProps.functionalManagers}
          directReports={actions.detailPanelProps.directReports}
          functionalReports={actions.detailPanelProps.functionalReports}
          onClose={() => setSelectedEmployee(null)}
          onSelectEmployee={setSelectedEmployee}
        />
      )}
      {actions.linkModalProps && (
        <LinkExistingEmployeeModal
          title={actions.linkModalProps.title}
          candidates={actions.linkModalProps.candidates}
          isDisabled={actions.linkModalProps.isDisabled}
          onLink={actions.linkModalProps.onLink}
          onClose={() => actions.setLinkModal(null)}
        />
      )}
      {photoEmployee && (
        <PhotoEditorModal
          employeeName={`${photoEmployee.first_name} ${photoEmployee.last_name}`}
          photoPath={photoEmployee.photo_path}
          currentFrame={{
            zoom: photoEmployee.photo_zoom,
            panX: photoEmployee.photo_pan_x,
            panY: photoEmployee.photo_pan_y,
          }}
          onSave={async (file, frame) => {
            if (file) await actions.replacePhoto(photoEmployee.id, file);
            await actions.saveFrame(photoEmployee.id, frame);
          }}
          onDelete={() => actions.deletePhoto(photoEmployee.id)}
          onClose={() => actions.setPhotoEditEmployeeId(null)}
        />
      )}
    </div>
  );
}
