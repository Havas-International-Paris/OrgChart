import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyNodeChanges, type Edge, type Node, type NodeChange } from '@xyflow/react';
import type { ReportingRelationship } from '../../types/domain';
import { useSelectionStore } from '../../stores/selectionStore';
import { NEUTRAL_DEPARTMENT_COLOR } from '../../lib/departmentColor';
import { layoutWithElk, NODE_HEIGHT, NODE_WIDTH } from './layoutEngine';
import { routeAroundObstacles, type Rect } from './edgeRouting';
import { ROOT_GROUP_KEY } from './siblingOrder';
import { computeReorder, findDisplacementTargets, type ChartGeometry } from './siblingReorderGeometry';
import { useReportingChain } from './useReportingChain';
import type { EmployeeNodeData } from './EmployeeNode';
import type { ReportingEdgeData } from './ReportingEdge';
import type { ChartData } from './useChartData';
import type { ChartActions } from './useChartActions';
import type { useChartVisibility } from './useChartVisibility';

interface ChartNodesInput {
  data: ChartData;
  visibility: ReturnType<typeof useChartVisibility>;
  actions: ChartActions;
  deptFilterNames: Set<string>;
  jobTitleFilterNames: Set<string>;
  etpVenduRange: { min: number; max: number };
  etpReelRange: { min: number; max: number };
}

// The React Flow node and edge arrays, and everything that has to stay welded to
// them: the dagre layout, the per-render styling pass, the controlled array React
// Flow actually renders, live drag position, and hover.
//
// These are ONE unit on purpose. `flowNodes`, `isDraggingRef`,
// `displacementTargetIds` and the two drag handlers were tried as separate
// concerns before and cannot be: splitting them means passing setters between
// hooks, which is exactly what reintroduces the infinite render loop and the
// drag flicker documented below. The reorder *geometry* is the part that could
// be separated cleanly, and it lives in siblingReorderGeometry.ts (unit-tested).
export function useChartNodes({
  data,
  visibility,
  actions,
  deptFilterNames,
  jobTitleFilterNames,
  etpVenduRange,
  etpReelRange,
}: ChartNodesInput) {
  const { t } = useTranslation();
  const {
    employees,
    employeeById,
    primaryEdges,
    secondaryEdges,
    primaryManagerOf,
    relationships,
    managersOf,
    directReportsOf,
    assignmentsOf,
    totalEtpOf,
    totalEtpReelOf,
    clientMissionNameById,
    jobTitleNames,
    departmentNames,
    departmentColorByName,
    matchingEmployeeIds,
    updateSiblingOrders,
  } = data;
  const {
    childrenOf,
    totalDescendantCountOf,
    finalVisibleEmployees,
    focusHiddenCount,
    matchedIds,
    expandedNodeIds,
    focusedNodeIds,
  } = visibility;
  const { actions: nodeActions } = actions;

  const selectedEmployeeId = useSelectionStore((s) => s.selectedEmployeeId);
  const toggleExpanded = useSelectionStore((s) => s.toggleExpanded);
  const toggleFocused = useSelectionStore((s) => s.toggleFocused);

  // Hovering highlights the reporting chain the same way pinning (clicking)
  // a card does; hover takes priority while active, falling back to the
  // pinned selection once the mouse leaves — un-hovering never clears a
  // pin, matching the design spec.
  const [hoverEmployeeId, setHoverEmployeeId] = useState<string | null>(null);
  // Set while a native edge-reconnect drag is in progress (set/cleared by
  // handleReconnectStart/handleReconnectEnd below, wired to <ReactFlow>'s
  // onReconnectStart/onReconnectEnd) — see the mouse handlers at the bottom
  // for why hover updates must be suppressed during a drag. A ref, not
  // state: it only gates a synchronous check inside those handlers and never
  // needs to trigger a render itself — using state here left a real race,
  // since a node crossed in the same tick as the drag's start could still
  // read the pre-update value before React's batched setState had flushed.
  const isReassigningEdgeRef = useRef(false);
  const isDraggingRef = useRef(false);
  // Debounces the mouseLeave→null transition so crossing the small gap
  // between two adjacent cards doesn't flash "nothing hovered" for a frame —
  // React Flow's per-node native mouseenter/mouseleave have no cross-node
  // ordering guarantee, so leaving card A and entering card B are two
  // independent events with a real gap between them. A fresh mouseEnter
  // cancels this before it fires; the guards are re-checked INSIDE the
  // timeout too, since a drag/reassign can start during the delay.
  const clearHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hovering a LINK (not a card) highlights just its own two endpoint cards
  // plus the link itself — deliberately narrower than hoverEmployeeId's full
  // ancestor/descendant chain above, since the point here is to disambiguate
  // one specific relationship among several that can visually overlap (a
  // manager with many reports). Same debounce reasoning as clearHoverTimeoutRef,
  // kept as its own ref/state pair rather than shared: overlapping links make
  // an A→B leave/enter pair even more likely here than for adjacent cards.
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const clearEdgeHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleEdgeHoverChange = useCallback((edgeId: string, hovering: boolean) => {
    if (clearEdgeHoverTimeoutRef.current) {
      clearTimeout(clearEdgeHoverTimeoutRef.current);
      clearEdgeHoverTimeoutRef.current = null;
    }
    if (hovering) {
      setHoveredEdgeId(edgeId);
    } else {
      clearEdgeHoverTimeoutRef.current = setTimeout(() => {
        clearEdgeHoverTimeoutRef.current = null;
        setHoveredEdgeId((cur) => (cur === edgeId ? null : cur));
      }, 120);
    }
  }, []);

  // `flowNodes` is the controlled array React Flow renders; `computedNodes`
  // (below) is the single source of truth, re-synced into it whenever it
  // legitimately changes. Declared before the handlers that write to them so
  // the file reads in dependency order — in the original single-file version
  // these sat 300 lines *below* their first use.
  const [flowNodes, setFlowNodes] = useState<Node<EmployeeNodeData>[]>([]);
  // Live drag-only feedback: whichever sibling (+ their descendants) is nearest
  // the dragged card is who's about to be displaced. Kept as its OWN small
  // piece of state rather than folded into flowNodes/computedNodes so
  // recomputing it on every drag frame stays cheap (no dagre re-layout, no full
  // styling pass).
  const [displacementTargetIds, setDisplacementTargetIds] = useState<Set<string>>(new Set());

  const activeEmployeeId = hoverEmployeeId ?? selectedEmployeeId;
  const { relatedIds, chainIds } = useReportingChain(activeEmployeeId, relationships, childrenOf);

  // elk lays out the *entire* org chart, every employee, regardless of
  // what's currently expanded/collapsed/focused — never just the visible
  // subset. Collapsing a team, isolating someone via focus mode, or
  // hovering (dimming) must never shift anyone's position on screen; elk
  // isn't a stable/incremental layout, so re-running it on a smaller or
  // larger node set reflows *everyone*, not just the nodes that
  // appeared/disappeared. Laying out the full tree once and then simply
  // filtering which nodes/edges get rendered (below) keeps every visible
  // card's position fixed no matter how the visible subset changes. This
  // also means elk only re-runs when employees or primary reporting edges
  // actually change — not on hover, selection, search, the dept filter, or
  // any visibility toggle — which is what stops rapid hovering from
  // stuttering. KEEP THIS EFFECT FREE of visibility/styling deps.
  //
  // Unlike dagre, elk.layout() is async — this is state populated by an
  // effect rather than a plain useMemo. layoutRequestIdRef discards a stale
  // response if employees/primaryEdges change again before an in-flight
  // layout call resolves. Everything downstream (computedNodes, below, and
  // useChartViewport's fitView gate) already tolerates layoutedNodeById
  // being empty or momentarily missing a brand-new node — see
  // layoutEngine.ts's migration notes.
  const [layoutedNodeById, setLayoutedNodeById] = useState<Map<string, Node>>(new Map());
  const layoutRequestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++layoutRequestIdRef.current;
    const rawNodes: Node[] = employees.map((employee) => ({
      id: employee.id,
      type: 'employee',
      position: { x: 0, y: 0 },
      // Placeholder — only .position is ever read back off layoutedNodeById;
      // real per-node data is attached later, in the styled nodes memo below.
      data: {},
    }));
    const primaryEdgeAll = primaryEdges.map((r) => ({ id: r.id, source: r.manager_id, target: r.employee_id }));
    layoutWithElk(rawNodes, primaryEdgeAll, (id) => employeeById.get(id)?.sibling_order ?? null).then((laidOut) => {
      if (layoutRequestIdRef.current !== requestId) return;
      setLayoutedNodeById(new Map(laidOut.map((n) => [n.id, n])));
    });
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

  const handleNodeDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  // Drag-to-reorder among same-manager siblings ONLY — never a re-parent
  // (that's ReportingEdge.tsx's grip drag). All the geometry lives in
  // siblingReorderGeometry.ts; this is just the glue that turns its decision
  // into either a snap-back or a persisted reorder.
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
      const label = employee
        ? t('history.reorder', { name: `${employee.first_name} ${employee.last_name}` })
        : t('history.reorderFallback');
      updateSiblingOrders(outcome.updates, label);
    },
    [reorderGeometry, layoutedNodeById, employeeById, updateSiblingOrders, t],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<EmployeeNodeData>>[]) => {
      setFlowNodes((nds) => applyNodeChanges(changes, nds));

      // Recomputed on every drag frame, so it must stay cheap: no dagre
      // re-layout, no styling pass, only position reads. A batch carrying
      // several position changes ends on the last one.
      for (const change of changes) {
        if (change.type !== 'position' || !change.position) continue;
        setDisplacementTargetIds(
          findDisplacementTargets(reorderGeometry, change.id, change.position.x),
        );
      }
    },
    [reorderGeometry],
  );

  // The relationship a hovered link belongs to, if any — looked up once per
  // render rather than per-employee inside the big memo below, since every
  // employee's isHoverEdgeEndpoint check just needs its manager_id/employee_id.
  const hoveredRelationship = useMemo(
    () => (hoveredEdgeId ? (relationships.find((r) => r.id === hoveredEdgeId) ?? null) : null),
    [hoveredEdgeId, relationships],
  );

  const { nodes: computedNodes, edges } = useMemo(() => {
    const visibleIds = new Set(finalVisibleEmployees.map((e) => e.id));

    // Default bounds (0-150) mean "inactive" — same convention as the empty
    // Sets below, kept in sync with selectionStore.ts's defaults and
    // FiltersPanel.tsx's slider bounds.
    const isVenduRangeActive = etpVenduRange.min > 0 || etpVenduRange.max < 150;
    const isReelRangeActive = etpReelRange.min > 0 || etpReelRange.max < 150;

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

      // One Handle id per relationship, ordered by each neighbor's own
      // laid-out x — see EmployeeNode.tsx for why (lets a native reconnect
      // or a brand-new connect drag grab/drop one specific relationship
      // instead of every edge on a side sharing a single point). Both sides
      // always have at least one entry: someone with zero current reports
      // still needs a connectable bottom handle to be a valid drop target
      // for a first-ever reassignment or a new drag-to-connect link, and
      // symmetrically someone with zero current managers needs a
      // connectable top handle for the same reason on the incoming side.
      const outgoingRelationships = directReportsOf(employee.id);
      const outgoingHandleIds =
        outgoingRelationships.length > 0
          ? [...outgoingRelationships]
              .sort(
                (a, b) =>
                  (layoutedNodeById.get(a.employee_id)?.position.x ?? 0) -
                  (layoutedNodeById.get(b.employee_id)?.position.x ?? 0),
              )
              .map((r) => r.id)
          : [`${employee.id}-out`];
      const incomingRelationships = managersOf(employee.id);
      const incomingHandleIds =
        incomingRelationships.length > 0
          ? [...incomingRelationships]
              .sort(
                (a, b) =>
                  (layoutedNodeById.get(a.manager_id)?.position.x ?? 0) -
                  (layoutedNodeById.get(b.manager_id)?.position.x ?? 0),
              )
              .map((r) => r.id)
          : [`${employee.id}-in`];

      const advertiserNames = assignmentsOf(employee.id)
        .map((a) => clientMissionNameById.get(a.client_mission_id))
        .filter((name): name is string => Boolean(name));
      const isDimmed =
        (deptFilterNames.size > 0 &&
          (employee.department === null || !deptFilterNames.has(employee.department))) ||
        (jobTitleFilterNames.size > 0 &&
          (employee.job_title === null || !jobTitleFilterNames.has(employee.job_title))) ||
        (isVenduRangeActive &&
          (totalEtpOf(employee.id) < etpVenduRange.min || totalEtpOf(employee.id) > etpVenduRange.max)) ||
        (isReelRangeActive &&
          (totalEtpReelOf(employee.id) < etpReelRange.min || totalEtpReelOf(employee.id) > etpReelRange.max)) ||
        (matchingEmployeeIds !== null && !matchingEmployeeIds.has(employee.id)) ||
        (activeEmployeeId !== null && !relatedIds.has(employee.id));
      const isHoverEdgeEndpoint =
        hoveredRelationship !== null &&
        (employee.id === hoveredRelationship.manager_id || employee.id === hoveredRelationship.employee_id);

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
            // hover chain).
            isChainHighlighted: !isDimmed && activeEmployeeId !== null && relatedIds.has(employee.id),
            // Static default here — this memo must NOT depend on drag-
            // transient state (it's the expensive per-render styling pass
            // over every visible employee). The real, live value is merged
            // in separately via the lightweight `renderedNodes` derivation
            // below, the same way flowNodes overrides live drag position.
            isDisplacementTarget: false,
            isHoverEdgeEndpoint,
            incomingHandleIds,
            outgoingHandleIds,
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
            actions: nodeActions,
          },
        },
      ];
    });

    // An edge is part of the highlighted chain if it touches the active
    // person directly (covers incoming-dotted reporters, whose edge
    // wouldn't otherwise qualify — see useReportingChain), or if both its
    // ends sit inside the ancestor/descendant chain. The currently-hovered
    // edge is always highlighted too, regardless of any pin chain — the
    // user needs to see at a glance which relationship a right-click would
    // act on, especially with several links overlapping (a manager with
    // many reports) where only the highlighted one's color/width picks it
    // out.
    const edgeHighlight = (
      managerId: string,
      employeeId: string,
      relationshipId: string,
    ): 'highlighted' | 'dimmed' | 'normal' => {
      if (relationshipId === hoveredEdgeId) return 'highlighted';
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
      isPrimary: relationship.is_primary,
      onHoverChange: (hovering) => handleEdgeHoverChange(relationship.id, hovering),
    });

    // sourceHandle/targetHandle both use the relationship's own id — see
    // EmployeeNode.tsx's per-relationship Handle lists, which are keyed the
    // same way. `reconnectable: 'source'` restricts a native drag to the
    // manager end only, matching the old grip's exact constraint (the
    // employee/target end never moves).
    const styledPrimaryEdges: Edge<ReportingEdgeData>[] = primaryEdgeBase.map(({ relationship, ...e }) => {
      const state = edgeHighlight(e.source, e.target, relationship.id);
      return {
        ...e,
        type: 'reporting',
        sourceHandle: relationship.id,
        targetHandle: relationship.id,
        reconnectable: 'source' as const,
        data: edgeData(relationship),
        style:
          state === 'highlighted'
            ? { stroke: subordinateColor(e.target), strokeWidth: 2.5 }
            : state === 'dimmed'
              ? { opacity: 0.08 }
              : undefined,
      };
    });

    // Obstacle rectangles for edgeRouting.ts's routeAroundObstacles — every
    // currently-visible card's own box, in the same top-left coordinate
    // space layoutedNodeById already uses. Computed once per render of this
    // memo (i.e. only when the layout/visible-set actually changes, same as
    // everything else here), not per edge.
    const obstacleRectById = new Map<string, Rect>();
    for (const employee of finalVisibleEmployees) {
      const base = layoutedNodeById.get(employee.id);
      if (!base) continue;
      obstacleRectById.set(employee.id, {
        x: base.position.x,
        y: base.position.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    }

    const styledSecondaryEdges: Edge<ReportingEdgeData>[] = secondaryEdgeBase.map(({ relationship, ...e }) => {
      const state = edgeHighlight(e.source, e.target, relationship.id);
      // A dotted line only ever needs a detour when its direct curve would
      // cross an unrelated card — routeAroundObstacles returns null in the
      // overwhelming common case, and that null just falls through to the
      // plain bezier ReportingEdge.tsx already draws. Only OTHER cards count
      // as obstacles: the edge's own two endpoints are excluded, using each
      // node's bottom/top-center as its approximate connection point (exact
      // handle offsets don't matter for deciding whether a distant,
      // unrelated card sits in the way).
      const sourceRect = obstacleRectById.get(e.source);
      const targetRect = obstacleRectById.get(e.target);
      const bendPoints =
        sourceRect && targetRect
          ? routeAroundObstacles(
              { x: sourceRect.x + NODE_WIDTH / 2, y: sourceRect.y + NODE_HEIGHT },
              { x: targetRect.x + NODE_WIDTH / 2, y: targetRect.y },
              [...obstacleRectById.entries()]
                .filter(([id]) => id !== e.source && id !== e.target)
                .map(([, rect]) => rect),
            )
          : null;
      return {
        ...e,
        type: 'reporting',
        sourceHandle: relationship.id,
        targetHandle: relationship.id,
        reconnectable: 'source' as const,
        data: { ...edgeData(relationship), bendPoints: bendPoints ?? undefined },
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
    nodeActions,
    assignmentsOf,
    totalEtpOf,
    totalEtpReelOf,
    totalDescendantCountOf,
    managersOf,
    directReportsOf,
    clientMissionNameById,
    deptFilterNames,
    jobTitleFilterNames,
    etpVenduRange,
    etpReelRange,
    matchingEmployeeIds,
    jobTitleNames,
    departmentNames,
    departmentColorByName,
    hoveredEdgeId,
    hoveredRelationship,
    handleEdgeHoverChange,
  ]);

  // React Flow only renders a node's position from its OWN internal store
  // during a live drag if that node is under "controlled" management (a
  // `nodes` prop paired with `onNodesChange`) — otherwise the drag ends up
  // computing a final position (which is all `onNodeDragStop` needs) without
  // ever visibly tracking the cursor. Syncing computedNodes into flowNodes is
  // safe via a plain effect only because every one of computedNodes's
  // dependencies is properly memoized (see useEmployees.ts/useReportingGraph.ts's
  // useCallback wrapping), so this fires on real changes rather than every
  // render — an earlier attempt at this same pattern, before that
  // stabilization existed, looped infinitely for exactly that reason.
  //
  // `isDraggingRef` additionally skips the sync WHILE a drag is in flight:
  // dragging one node moves the cursor over OTHER cards too, firing their
  // mouse-enter/leave — which changes hoverEmployeeId, which legitimately
  // recomputes computedNodes (the hover/chain-highlight dimming depends on
  // it) — and without this guard, every such recompute would overwrite the
  // in-progress drag's live position with the last-committed one, fighting
  // the drag update every time the cursor crosses another card (visible as
  // flicker, worse the longer/more cards a drag crosses). Syncing resumes
  // the instant the drag stops, so the eventual post-mutation layout still
  // takes over normally.
  useEffect(() => {
    if (isDraggingRef.current) return;
    setFlowNodes(computedNodes);
  }, [computedNodes]);

  const renderedNodes = useMemo(() => {
    if (displacementTargetIds.size === 0) return flowNodes;
    return flowNodes.map((n) =>
      displacementTargetIds.has(n.id) !== Boolean((n.data as EmployeeNodeData | null)?.isDisplacementTarget)
        ? { ...n, data: { ...n.data, isDisplacementTarget: displacementTargetIds.has(n.id) } }
        : n,
    );
  }, [flowNodes, displacementTargetIds]);

  // Hover is suppressed during either kind of drag: a node reorder, and an edge
  // grip reassignment. Both move the cursor across unrelated cards on the way to
  // the target, firing genuine native enter/leave that would otherwise re-dim
  // most of the chart mid-gesture.
  const handleNodeMouseEnter = useCallback((_event: unknown, node: Node) => {
    if (clearHoverTimeoutRef.current) {
      clearTimeout(clearHoverTimeoutRef.current);
      clearHoverTimeoutRef.current = null;
    }
    if (!isReassigningEdgeRef.current && !isDraggingRef.current) setHoverEmployeeId(node.id);
  }, []);

  const handleNodeMouseLeave = useCallback(() => {
    if (isReassigningEdgeRef.current || isDraggingRef.current) return;
    clearHoverTimeoutRef.current = setTimeout(() => {
      clearHoverTimeoutRef.current = null;
      if (!isReassigningEdgeRef.current && !isDraggingRef.current) setHoverEmployeeId(null);
    }, 120);
  }, []);

  useEffect(() => {
    return () => {
      if (clearHoverTimeoutRef.current) clearTimeout(clearHoverTimeoutRef.current);
      if (clearEdgeHoverTimeoutRef.current) clearTimeout(clearEdgeHoverTimeoutRef.current);
    };
  }, []);

  // Wired to <ReactFlow>'s onReconnectStart/onReconnectEnd AND
  // onConnectStart/onConnectEnd (OrgChartView.tsx) — both a reconnect drag
  // and a brand-new connect drag cross unrelated cards on the way to their
  // target the same way, so both reuse this one pair of callbacks. Same
  // isReassigningEdgeRef the old grip's onDragStateChange callback used to
  // flip, just retargeted to React Flow's native connection gestures.
  const handleReconnectStart = useCallback(() => {
    isReassigningEdgeRef.current = true;
  }, []);
  const handleReconnectEnd = useCallback(() => {
    isReassigningEdgeRef.current = false;
  }, []);

  return {
    computedNodes,
    renderedNodes,
    edges,
    handleNodesChange,
    handleNodeDragStart,
    handleNodeDragStop,
    handleNodeMouseEnter,
    handleNodeMouseLeave,
    handleReconnectStart,
    handleReconnectEnd,
  };
}
