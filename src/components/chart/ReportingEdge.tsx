import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
  Position,
  type EdgeProps,
} from 'reactflow';

// How far from the employee toward the manager the grip sits (t=0 is the
// manager/source end, t=1 is the employee/target end — see the edge
// construction in OrgChartView, `source: r.manager_id, target: r.employee_id`).
// 0.2 puts it 4/5 of the way toward the manager, reinforcing that dragging it
// only ever reassigns the manager side, never the employee.
const GRIP_T = 0.2;

// Re-derives the exact cubic-bezier point React Flow's own getBezierPath
// draws at a given t — the public API only returns the curve's fixed
// midpoint (t=0.5, via labelX/labelY), not an arbitrary point along it, so
// this mirrors @reactflow/core's internal getControlWithCurvature /
// calculateControlOffset to place the grip somewhere else on the same curve.
function bezierPointAt(
  t: number,
  params: {
    sourceX: number;
    sourceY: number;
    sourcePosition: Position;
    targetX: number;
    targetY: number;
    targetPosition: Position;
    curvature?: number;
  },
): { x: number; y: number } {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature = 0.25 } = params;
  const controlOffset = (distance: number) =>
    distance >= 0 ? 0.5 * distance : curvature * 25 * Math.sqrt(-distance);
  const controlPoint = (pos: Position, x1: number, y1: number, x2: number, y2: number): [number, number] => {
    switch (pos) {
      case Position.Left:
        return [x1 - controlOffset(x1 - x2), y1];
      case Position.Right:
        return [x1 + controlOffset(x2 - x1), y1];
      case Position.Top:
        return [x1, y1 - controlOffset(y1 - y2)];
      case Position.Bottom:
        return [x1, y1 + controlOffset(y2 - y1)];
    }
  };
  const [scx, scy] = controlPoint(sourcePosition, sourceX, sourceY, targetX, targetY);
  const [tcx, tcy] = controlPoint(targetPosition, targetX, targetY, sourceX, sourceY);
  const mt = 1 - t;
  return {
    x: mt ** 3 * sourceX + 3 * mt ** 2 * t * scx + 3 * mt * t ** 2 * tcx + t ** 3 * targetX,
    y: mt ** 3 * sourceY + 3 * mt ** 2 * t * scy + 3 * mt * t ** 2 * tcy + t ** 3 * targetY,
  };
}

export type DropValidity = 'valid' | 'invalid';

export interface ReportingEdgeData {
  onDelete: () => void;
  onReassignHover: (targetEmployeeId: string) => DropValidity;
  onReassignDrop: (targetEmployeeId: string) => void;
  // Lets OrgChartView suppress its own hover-driven dimming while a grip
  // drag is in flight — see the mousemove handler below for why this is
  // needed (the cursor crosses other cards' real DOM elements on the way to
  // the drop target, firing genuine native mouseenter/mouseleave that would
  // otherwise repeatedly re-dim most of the chart).
  onDragStateChange: (dragging: boolean) => void;
  // Primary relationships route as right angles (getSmoothStepPath); only
  // secondary/dotted ones keep the original bezier curve — see the path
  // computation below.
  isPrimary: boolean;
}

function applyDropStyle(el: HTMLElement, validity: DropValidity) {
  el.style.outline = validity === 'valid' ? '2px solid #10b981' : '2px solid #ef4444';
  el.style.outlineOffset = '2px';
  el.style.borderRadius = '0.5rem';
}

function clearDropStyle(el: Element | null) {
  if (!el || !(el instanceof HTMLElement)) return;
  el.style.outline = '';
  el.style.outlineOffset = '';
}

// The delete button sits at the edge's MIDPOINT (getBezierPath's
// labelX/labelY) and the drag-to-reassign grip sits further along, biased
// toward the manager end so dragging it visually reads as detaching the
// manager side specifically (the only end reassigning ever moves) — never
// at either literal endpoint. This is deliberate: every EmployeeNode has
// exactly one unnamed Handle per side, so several edges converging on the
// same person (multi-reporting) all resolve to the exact same endpoint
// pixel in React Flow — its own built-in onReconnect draws its grab zone
// right there, so overlapping edges would be unreachable except the
// topmost one. The bias must be expressed along whichever axis actually
// distinguishes two edges sharing an endpoint: for secondary (bezier)
// edges that's inherent to the curve's parametric shape (bezierPointAt),
// but for primary (step-routed) edges the axis matters — the step path's
// two vertical stubs are identical for every direct report of one manager
// (same sourceX/sourceY/targetY), so a grip placed there collapses for
// every sibling at once; only the horizontal jog varies per sibling (it
// depends on that child's own targetX), which is why the primary-edge
// formula below is expressed in X, not Y.
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
}: EdgeProps<ReportingEdgeData>) {
  const [hovering, setHovering] = useState(false);
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
  const { screenToFlowPosition } = useReactFlow();
  const isPrimary = data!.isPrimary;
  // Primary edges route as sharp right angles (borderRadius: 0 — the same
  // technique React Flow's own built-in StepEdge uses internally);
  // secondary/dotted ones keep the bezier curve.
  const [path, labelX, labelY] = isPrimary
    ? getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 0 })
    : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  // For a step-routed primary edge, the grip must sit on the horizontal
  // jog (the only segment that varies per sibling — see the comment
  // above) rather than either vertical stub, which every direct report of
  // one manager shares identically. (sourceY+targetY)/2 reproduces
  // getSmoothStepPath's own default centerY (matches labelY); the -14
  // nudge keeps the grip visually distinct from the delete button even
  // when a lone direct report is centered directly below its manager
  // (targetX ≈ sourceX, collapsing the horizontal segment to ~0 width).
  const gripPoint = isPrimary
    ? { x: sourceX + GRIP_T * (targetX - sourceX), y: (sourceY + targetY) / 2 - 14 }
    : bezierPointAt(GRIP_T, { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  function handleGripMouseDown(e: ReactMouseEvent) {
    e.stopPropagation();
    data!.onDragStateChange(true);
    let draggedOverId: string | null = null;

    function onMove(ev: MouseEvent) {
      setDragPoint(screenToFlowPosition({ x: ev.clientX, y: ev.clientY }));
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const nodeEl = el?.closest<HTMLElement>('.react-flow__node');
      const hoveredId = nodeEl?.getAttribute('data-id') ?? null;
      if (hoveredId === draggedOverId) return;
      if (draggedOverId) {
        clearDropStyle(document.querySelector(`.react-flow__node[data-id="${draggedOverId}"]`));
      }
      draggedOverId = hoveredId;
      if (hoveredId && nodeEl) {
        applyDropStyle(nodeEl, data!.onReassignHover(hoveredId));
      }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setDragPoint(null);
      data!.onDragStateChange(false);
      if (draggedOverId) {
        clearDropStyle(document.querySelector(`.react-flow__node[data-id="${draggedOverId}"]`));
        data!.onReassignDrop(draggedOverId);
      }
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ ...style, opacity: dragPoint ? 0.25 : (style?.opacity ?? 1) }}
        markerEnd={markerEnd}
      />
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
        style={{ pointerEvents: 'stroke' }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      />
      {dragPoint && (
        // Anchored at the fixed employee end (targetX/targetY) — only the
        // manager end ever moves, so this visually shows that end
        // detaching and following the cursor, which is what makes the
        // single grip's direction unambiguous (see ReportingEdgeData).
        <path
          d={getStraightPath({ sourceX: dragPoint.x, sourceY: dragPoint.y, targetX, targetY })[0]}
          fill="none"
          stroke="#0f172a"
          strokeWidth={2}
          strokeDasharray="4 3"
          style={{ pointerEvents: 'none' }}
        />
      )}
      {hovering && (
        <EdgeLabelRenderer>
          <div
            data-export-hide
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
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
          <div
            data-export-hide
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${gripPoint.x}px, ${gripPoint.y}px)`,
              pointerEvents: 'all',
            }}
          >
            <button
              type="button"
              onMouseDown={handleGripMouseDown}
              title="Glisser vers un autre manager"
              className="nodrag nopan flex h-[18px] w-[18px] cursor-grab items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] leading-none text-slate-500 shadow-sm hover:bg-slate-50 active:cursor-grabbing"
            >
              ⠿
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
