import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactFlow, Background, Controls, MiniMap, Panel } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUiPreferencesStore } from '../../stores/uiPreferencesStore';
import { LinkExistingEmployeeModal } from '../shared/LinkExistingEmployeeModal';
import { PhotoEditorModal } from '../shared/PhotoEditorModal';
import { EmployeeNode } from './EmployeeNode';
import { ReportingEdge } from './ReportingEdge';
import { NodeContextMenu } from './NodeContextMenu';
import { ContextMenu } from './ContextMenu';
import { DepartmentLegend } from './DepartmentLegend';
import { ChartOptionsMenu } from './ChartOptionsMenu';
import { EmployeeDetailPanel } from './EmployeeDetailPanel';
import { exportChartAsPng } from './exportChartImage';
import { isE2EMode } from '../../lib/e2eMode';
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
  const { t } = useTranslation();
  const currentOrgChartId = useSelectionStore((s) => s.currentOrgChartId);
  const selectedEmployeeId = useSelectionStore((s) => s.selectedEmployeeId);
  const setSelectedEmployee = useSelectionStore((s) => s.setSelectedEmployee);
  const setDetailPanelEmployeeId = useSelectionStore((s) => s.setDetailPanelEmployeeId);
  const setExpandedNodeIds = useSelectionStore((s) => s.setExpandedNodeIds);
  const setFocusedNodeIds = useSelectionStore((s) => s.setFocusedNodeIds);

  // Business Unit / Poste / ETP range filters — shared with the grid via
  // selectionStore; the chart-local DepartmentLegend below is a read-only
  // color key, not where these filters are set (that's the header's
  // FiltersPanel). Threaded into useChartNodes the same way each was added.
  const deptFilterNames = useSelectionStore((s) => s.deptFilterNames);
  const toggleDeptFilter = useSelectionStore((s) => s.toggleDeptFilter);
  const companyFilterNames = useSelectionStore((s) => s.companyFilterNames);
  const toggleCompanyFilter = useSelectionStore((s) => s.toggleCompanyFilter);
  const jobTitleFilterNames = useSelectionStore((s) => s.jobTitleFilterNames);
  const etpVenduRange = useSelectionStore((s) => s.etpVenduRange);
  const etpReelRange = useSelectionStore((s) => s.etpReelRange);

  const cardDensity = useUiPreferencesStore((s) => s.chartCardDensity);
  const setCardDensity = useUiPreferencesStore((s) => s.setChartCardDensity);
  const chartColorBy = useUiPreferencesStore((s) => s.chartColorBy);
  const setChartColorBy = useUiPreferencesStore((s) => s.setChartColorBy);

  const data = useChartData(currentOrgChartId);
  const visibility = useChartVisibility(data.employees, data.primaryEdges);
  const actions = useChartActions(currentOrgChartId, data);
  const nodes = useChartNodes({
    data,
    visibility,
    actions,
    deptFilterNames,
    companyFilterNames,
    jobTitleFilterNames,
    etpVenduRange,
    etpReelRange,
  });
  const { reactFlowInstanceRef, skipPanTo } = useChartViewport({
    currentOrgChartId,
    employees: data.employees,
    employeesLoading: data.employeesLoading,
    relationshipsLoading: data.relationshipsLoading,
    computedNodes: nodes.computedNodes,
    matchedIds: visibility.matchedIds,
    expandedNodeIds: visibility.expandedNodeIds,
    selectedEmployeeId,
    getPrimaryManagerId: data.getPrimaryManagerId,
  });

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Above FULL_EXPAND_THRESHOLD (useChartViewport.ts), the chart defaults to
  // roots + one level rather than fully expanded. This is the manual override
  // for "no, I actually want to see everyone" — sets every employee expanded
  // and leaves the current pan/zoom untouched (deliberately no fitView call
  // here: a real user report was that this button unexpectedly changed the
  // zoom level, which isn't what "expand" should do — only useChartViewport's
  // own one-time initial auto-fit and handleExport's own capture are allowed
  // to move the viewport).
  //
  // Also clears focusedNodeIds — a second, real bug the user caught right
  // after the zoom fix: expandedNodeIds only controls visibility DOWNWARD
  // (a card's own subtree), while "focus mode" (the top collapse badge,
  // useChartVisibility.ts) hides everyone ABOVE/beside a focused card
  // regardless of expandedNodeIds. Without resetting it too, "Expand all"
  // correctly revealed every descendant but any active focus mode still hid
  // ancestors and unrelated branches — exactly the "unfolds what's below but
  // not above" symptom reported. Expand all is meant to mean "show
  // everyone," so both hiding mechanisms need clearing together.
  function handleExpandAll() {
    setExpandedNodeIds(new Set(data.employees.map((e) => e.id)));
    setFocusedNodeIds(new Set());
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
        {t('chart.emptyState')}
      </div>
    );
  }

  const photoEmployee = actions.photoEditEmployeeId
    ? (data.employeeById.get(actions.photoEditEmployeeId) ?? null)
    : null;

  // The decorative overlays sit on top of the canvas and intercept pointer events
  // on any card beneath them, which is what makes the chart unclickable under
  // automation. Hidden in test mode only — see lib/e2eMode.ts.
  const showOverlays = !isE2EMode();

  return (
    <div className="relative h-full w-full">
      {showOverlays && (
        <DepartmentLegend
          items={chartColorBy === 'company' ? data.companies : data.departments}
          colorByName={chartColorBy === 'company' ? data.companyColorByName : data.departmentColorByName}
          counts={chartColorBy === 'company' ? data.companyCounts : data.departmentCounts}
          selectedNames={chartColorBy === 'company' ? companyFilterNames : deptFilterNames}
          onToggle={chartColorBy === 'company' ? toggleCompanyFilter : toggleDeptFilter}
          hint={chartColorBy === 'company' ? t('filters.companyHint') : t('filters.businessUnitHint')}
          colorBy={chartColorBy}
          onColorByChange={setChartColorBy}
        />
      )}
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
        // A plain click only selects/highlights the card and never pans the
        // viewport onto it (skipPanTo, useChartViewport.ts) — recentering on
        // something you just clicked, already on screen, was judged noisy.
        // The detail panel likewise doesn't open on this first click; only a
        // SECOND click on an already-selected card opens it (checked against
        // selectedEmployeeId's pre-click value here). A click that lands on
        // an editable field/photo/the assignment gauges never reaches this
        // handler at all once the card is selected — each of those swallows
        // its own click via stopPropagation (see EmployeeNode.tsx) so it can
        // open its own control instead.
        onNodeClick={(_, node) => {
          skipPanTo(node.id);
          if (selectedEmployeeId === node.id) {
            setDetailPanelEmployeeId(node.id);
          }
          setSelectedEmployee(node.id);
        }}
        onPaneClick={() => {
          setSelectedEmployee(null);
          nodes.clearEdgeSelection();
        }}
        // Right-click menus (backlog item 34, extended to links same day) —
        // preventDefault suppresses the browser's own native context menu.
        // Positioned at the raw client coordinates; see ContextMenu.tsx for
        // why they render outside <ReactFlow> rather than inside the node/edge.
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          actions.openContextMenu(node.id, event.clientX, event.clientY);
        }}
        // Left-click highlights this one relationship (its two endpoint
        // cards + the line itself, useChartNodes.ts's selectedEdgeId) — lets
        // the user pick out exactly which manager/employee pair a line
        // connects when several overlap. Changed 2026-08-28 from a hover
        // trigger to a click, per user request.
        onEdgeClick={(_, edge) => nodes.handleEdgeClick(edge.id)}
        // Deleting a relationship is this same right-click menu (one item),
        // not the old click-to-select-then-click-the-'−'-button flow.
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault();
          actions.openEdgeContextMenu(edge.id, event.clientX, event.clientY);
        }}
        // Native drag-to-reconnect, replacing the old hand-rolled grip
        // (ReportingEdge.tsx). Each edge sets its own `reconnectable:
        // 'source'` (useChartNodes.ts), so only the manager end is ever
        // draggable — target/target-handle stays the fixed employee end
        // throughout. isValidConnection is what feeds both the actual
        // drop-rejection and EmployeeNode.tsx's live green/red ring via
        // useConnection().
        onReconnect={(oldEdge, connection) => actions.handleReconnect(oldEdge.id, connection.source)}
        // Native drag-to-connect: a shortcut for linking two employees
        // ALREADY visible on the chart, alongside (not instead of) the "+"
        // popover's "Rattacher un existant…", which stays the only way to
        // link someone not yet on the graph at all. Direction is always
        // top-down (drag from a manager candidate's own bottom/source
        // handle to the employee's top/target handle) — connectionMode
        // stays the default 'strict', so a connection can only ever start
        // from a source handle, which keeps the resulting edge's
        // source=manager/target=employee convention intact regardless of
        // which card the user grabs first. Reuses the exact same
        // isValidConnection machinery as reconnect above.
        onConnect={(connection) => actions.handleConnect(connection.source, connection.target)}
        isValidConnection={(connection) => actions.computeDropValidity(connection.target, connection.source) === 'valid'}
      >
        {showOverlays && (
          <Panel position="top-right">
            <ChartOptionsMenu
              cardDensity={cardDensity}
              onToggleDensity={() => setCardDensity(cardDensity === 'compact' ? 'detailed' : 'compact')}
              onExpandAll={handleExpandAll}
              onExport={handleExport}
              exporting={exporting}
              exportError={exportError}
            />
          </Panel>
        )}
        <Background />
        {showOverlays && <Controls />}
        {showOverlays && <MiniMap />}
      </ReactFlow>
      {actions.detailPanelProps && (
        <EmployeeDetailPanel
          employee={actions.detailPanelProps.employee}
          departmentColor={actions.detailPanelProps.departmentColor}
          manager={actions.detailPanelProps.manager}
          functionalManagers={actions.detailPanelProps.functionalManagers}
          directReports={actions.detailPanelProps.directReports}
          functionalReports={actions.detailPanelProps.functionalReports}
          isRegistryChart={actions.detailPanelProps.isRegistryChart}
          assignmentsTotalEtpVendu={actions.detailPanelProps.assignmentsTotalEtpVendu}
          assignmentsAvgActual={actions.detailPanelProps.assignmentsAvgActual}
          advertiserNames={actions.detailPanelProps.advertiserNames}
          onClose={() => setSelectedEmployee(null)}
          // Jumping to a manager/report from inside an already-open panel is
          // a deliberate "go there" action, same as a grid row click — keeps
          // opening that person's panel immediately (and, via the pan effect
          // in useChartViewport.ts, panning to them), unlike a plain chart
          // card click.
          onSelectEmployee={(id) => {
            setSelectedEmployee(id);
            setDetailPanelEmployeeId(id);
          }}
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
      {actions.contextMenu &&
        (() => {
          const employee = data.employeeById.get(actions.contextMenu.employeeId);
          if (!employee) return null;
          const id = actions.contextMenu.employeeId;
          return (
            <NodeContextMenu
              x={actions.contextMenu.x}
              y={actions.contextMenu.y}
              employeeName={`${employee.first_name} ${employee.last_name}`}
              onAddManager={() => actions.quickAddManager(id)}
              onLinkManager={() => actions.openLinkManager(id)}
              onAddSubordinate={() => actions.quickAddSubordinate(id)}
              onLinkSubordinate={() => actions.openLinkSubordinate(id)}
              onDelete={() => actions.handleDeleteEmployee(id)}
              onClose={actions.closeContextMenu}
            />
          );
        })()}
      {actions.edgeContextMenu &&
        (() => {
          const { edgeId, x, y } = actions.edgeContextMenu;
          return (
            <ContextMenu
              x={x}
              y={y}
              entries={[
                {
                  label: t('chart.deleteRelationship'),
                  danger: true,
                  onSelect: () => actions.handleDeleteRelationshipById(edgeId),
                },
              ]}
              onClose={actions.closeEdgeContextMenu}
            />
          );
        })()}
    </div>
  );
}
