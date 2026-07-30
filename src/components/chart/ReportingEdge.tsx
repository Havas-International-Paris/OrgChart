import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';

// Corner rounding on primary (orthogonal) edges. 0 gives the sharp right angles
// this started as; React Flow's own smoothstep default is 5. 8 reads as
// deliberately softened without losing the org-chart-bracket look. Only affects
// the corners themselves — the straight runs are unchanged.
const PRIMARY_CORNER_RADIUS = 8;

export type DropValidity = 'valid' | 'invalid';

// Extends Record<string, unknown> because @xyflow/react v12's Edge<T> now
// requires its data generic to satisfy that shape.
export interface ReportingEdgeData extends Record<string, unknown> {
  onDelete: () => void;
  // Primary relationships route orthogonally (getSmoothStepPath); only
  // secondary/dotted ones keep the original bezier curve — see the path
  // computation below.
  isPrimary: boolean;
  // Whether THIS edge is the one currently selected (click-to-select, not
  // hover — see useChartActions.ts's selectedEdgeId). Only one edge is ever
  // selected at a time, so there's no risk of two edges' controls
  // rendering at once regardless of where they're positioned.
  isSelected: boolean;
  onSelect: () => void;
  // Hover (not click) — see useChartNodes.ts's hoveredEdgeId. Distinct from
  // isSelected: hovering never opens the delete button, it only drives the
  // highlight below, so a user skimming across several stacked/overlapping
  // links (a manager with many reports) can see at a glance which specific
  // manager/employee pair a given line connects, without clicking anything.
  onHoverChange: (hovering: boolean) => void;
}

// The delete button renders once this edge is clicked (isSelected), not on
// hover: controls are revealed by clicking the link and stay visible until
// it's deselected (clicking elsewhere, a different link, a node, or the same
// link again). Reassigning the manager end used to be a second control here
// (a hand-rolled "grip" drag) — that's now a native React Flow reconnect
// drag on the edge's own rendered endpoint instead (see EmployeeNode.tsx's
// per-relationship Handles and OrgChartView.tsx's onReconnect), so this
// component only ever renders the delete affordance.
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
  const isSelected = data!.isSelected;
  // Primary edges route orthogonally with softened corners; secondary/dotted
  // ones keep the bezier curve, deliberately, so the two kinds of reporting
  // line stay distinguishable at a glance rather than converging on one look.
  const [path, labelX, labelY] = isPrimary
    ? getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: PRIMARY_CORNER_RADIUS,
      })
    : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
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
      */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onClick={(e) => {
          // Without this, the click also bubbles to the pane, whose own
          // onClick immediately deselects everything (see onPaneClick in
          // useChartNodes) — undoing the selection in the same tick.
          e.stopPropagation();
          data!.onSelect();
        }}
        onMouseEnter={() => data!.onHoverChange(true)}
        onMouseLeave={() => data!.onHoverChange(false)}
      />
      {isSelected && (
        <EdgeLabelRenderer>
          <div
            data-export-hide
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
          >
            <button
              type="button"
              onClick={() => data!.onDelete()}
              title="Supprimer ce rattachement"
              className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-bold leading-none text-slate-500 shadow-sm hover:border-red-300 hover:bg-red-50 hover:text-red-500"
            >
              −
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
