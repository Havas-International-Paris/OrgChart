import { useEffect, useRef } from 'react';
import type { Node, ReactFlowInstance } from 'reactflow';
import type { Employee } from '../../types/domain';
import { useSelectionStore } from '../../stores/selectionStore';
import { NODE_HEIGHT, NODE_WIDTH } from './layoutEngine';
import { isE2EMode } from '../../lib/e2eMode';

interface ViewportInput {
  currentOrgChartId: string | null;
  employees: Employee[];
  employeesLoading: boolean;
  relationshipsLoading: boolean;
  /** The laid-out node array React Flow will render, for fit/centre timing. */
  computedNodes: Node[];
  matchedIds: Set<string>;
  expandedNodeIds: Set<string>;
  selectedEmployeeId: string | null;
  getPrimaryManagerId: (employeeId: string) => string | null;
}

// Everything that moves the camera or decides what starts revealed. Grouped
// because all of it is timing-sensitive against the async data load, and all of
// it reaches for the imperative React Flow instance rather than props.
export function useChartViewport({
  currentOrgChartId,
  employees,
  employeesLoading,
  relationshipsLoading,
  computedNodes,
  matchedIds,
  expandedNodeIds,
  selectedEmployeeId,
  getPrimaryManagerId,
}: ViewportInput) {
  const setExpandedNodeIds = useSelectionStore((s) => s.setExpandedNodeIds);
  const expandAncestors = useSelectionStore((s) => s.expandAncestors);

  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  // Whether the initial auto-fit has run for the currently-loaded chart —
  // see the effect below for why this can't just be the `fitView` prop.
  const hasAutoFitRef = useRef(false);
  // Which employee we last recentered the view on — see the "Center on the
  // selected node" effect below for why this can't just be a `nodes` dep.
  const lastCenteredIdRef = useRef<string | null>(null);

  // Default expand state once employees AND relationships have both finished
  // their initial load: always fully expanded, regardless of org size — the
  // user explicitly wants to see everyone on open, and the manual "Étendre
  // tout" button (OrgChartView.tsx) plus per-card collapse remain for anyone
  // who wants to narrow the view back down afterwards. Was previously
  // roots-plus-one-level above 30 employees, on the theory that a fully
  // expanded large org wouldn't fit the canvas even at minimum zoom — dropped
  // per explicit user request; minZoom={0.1} on <ReactFlow> still lets the
  // auto-fit below zoom out arbitrarily far to make everyone fit.
  useEffect(() => {
    if (employeesLoading || relationshipsLoading) return;
    if (employees.length === 0 || expandedNodeIds.size > 0) return;
    setExpandedNodeIds(new Set(employees.map((e) => e.id)));
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
  // re-render paint before touching the DOM" trick used in handleExport,
  // giving React Flow's ResizeObserver a tick to measure the newly
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
  // `selectedEmployeeId` changing — `computedNodes` is a dependency too (a
  // freshly-created node isn't laid out yet on the same render that selects
  // it, so this needs to retry once dagre positions it), but it also gets a
  // new reference whenever the team-collapse or focus/isolate badge changes
  // the visible set, or hover dims other cards. The ref guard is what keeps
  // those from re-centering: toggling a badge on an already-selected card
  // doesn't change `selectedEmployeeId`, so it still matches
  // `lastCenteredIdRef.current` and the effect no-ops — only an actual change
  // of *who* is selected re-centers.
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
      {
        zoom: reactFlowInstanceRef.current.getZoom(),
        // Instant in test mode: a 400ms pan means a click can be attempted
        // against a card that is still travelling. See lib/e2eMode.ts.
        duration: isE2EMode() ? 0 : 400,
      },
    );
  }, [selectedEmployeeId, computedNodes]);

  return { reactFlowInstanceRef };
}
