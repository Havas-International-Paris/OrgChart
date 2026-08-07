import { BaseEdge, getBezierPath, getSmoothStepPath, ViewportPortal, type Edge, type EdgeProps } from '@xyflow/react';

// Corner rounding on primary (orthogonal) edges. 0 gives the sharp right angles
// this started as; React Flow's own smoothstep default is 5. 8 reads as
// deliberately softened without losing the org-chart-bracket look. Only affects
// the corners themselves — the straight runs are unchanged.
const PRIMARY_CORNER_RADIUS = 8;

export type DropValidity = 'valid' | 'invalid';

// Extends Record<string, unknown> because @xyflow/react v12's Edge<T> now
// requires its data generic to satisfy that shape.
export interface ReportingEdgeData extends Record<string, unknown> {
  // Primary relationships route orthogonally (getSmoothStepPath); only
  // secondary/dotted ones keep the original bezier curve — see the path
  // computation below.
  isPrimary: boolean;
  // Hover (not click) — see useChartNodes.ts's hoveredEdgeId. Drives the
  // highlight below; a user skimming across several stacked/overlapping
  // links (a manager with many reports) can see at a glance which specific
  // manager/employee pair a given line connects, without clicking anything.
  onHoverChange: (hovering: boolean) => void;
  // True when the line itself is hovered, OR either of its own two
  // endpoint cards is hovered/pinned — narrower than the broader chain
  // highlight (see useChartNodes.ts). Only ever set on secondary edges;
  // primary edges never need the on-top reveal below (geometrically
  // confined to the y-band between adjacent ranks, so they never pass
  // behind an unrelated card).
  isHoveredEdge?: boolean;
}

// Deleting a relationship is now a right-click menu (OrgChartView.tsx's
// onEdgeContextMenu + ContextMenu), not a click-to-select-then-click-the-
// delete-button flow — this component no longer owns any click/selection
// state at all, only the hover highlight and the path itself. Reassigning
// the manager end is a native React Flow reconnect drag on the edge's own
// rendered endpoint (see EmployeeNode.tsx's per-relationship Handles and
// OrgChartView.tsx's onReconnect).
export function ReportingEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps<Edge<ReportingEdgeData>>) {
  const isPrimary = data!.isPrimary;
  // Primary edges route orthogonally with softened corners; secondary/
  // dotted ones keep the plain bezier curve always — no obstacle-avoiding
  // detour (an earlier version tried that and was reverted): a dotted line
  // can pass behind an unrelated card, and the reveal-on-hover overlay
  // below is how the user gets a clear, undistorted look at one specific
  // link on demand instead.
  const path = isPrimary
    ? getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: PRIMARY_CORNER_RADIUS,
      })[0]
    : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })[0];

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {!isPrimary && data!.isHoveredEdge && (
        // Draws an exact visual duplicate of this edge above every card,
        // not just other edges — ViewportPortal is the one part of the
        // pan/zoom-transformed viewport that renders AFTER the nodes layer
        // in React Flow's own DOM (confirmed in the installed package's
        // source; there is no per-edge zIndex that reaches across the
        // edges/nodes layer boundary, only within the edges layer itself).
        // pointerEvents: 'none' keeps all real interaction — hover,
        // right-click, reconnect drag — on the original path below;
        // this is a pure visual echo, never a second hit target.
        <ViewportPortal>
          <svg style={{ position: 'absolute', overflow: 'visible', pointerEvents: 'none' }}>
            <path d={path} fill="none" style={style} />
          </svg>
        </ViewportPortal>
      )}
      {/*
        Rendered AFTER BaseEdge, not before: BaseEdge always renders its own
        invisible "react-flow__edge-interaction" path (strokeWidth 20 by
        default) following the exact same `d`. Whichever of the two
        identically-shaped invisible strokes comes LAST in the DOM wins real
        browser hit-testing (paint order), so putting ours first meant
        React Flow's own path silently ate every hover — for every edge
        shape, not just curvy/dashed ones, since both paths are 100%
        congruent regardless of curve. Moving ours after BaseEdge fixes
        this for good rather than depending on incidental geometry.
        Right-click (context menu) is wired at the <ReactFlow> level via
        onEdgeContextMenu, not here — it fires from this same hit-test path
        via normal DOM bubbling, same as hover already does.
      */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ pointerEvents: 'stroke', cursor: 'context-menu' }}
        onMouseEnter={() => data!.onHoverChange(true)}
        onMouseLeave={() => data!.onHoverChange(false)}
      />
    </>
  );
}
