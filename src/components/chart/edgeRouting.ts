// Obstacle-avoiding routing for secondary (dotted) reporting edges — item 36
// of the backlog. Primary edges never need this: elk's DOWN layout only ever
// connects a primary edge between two ADJACENT ranks, and the horizontal jog
// getSmoothStepPath draws for one always falls entirely within the y-band
// between the parent's bottom edge and the child's top edge, a band no other
// node's body ever occupies (every node sits at a fixed rank y). Secondary
// edges have no such guarantee — a dotted line to a functional manager can
// span several ranks and columns, and a straight/bezier line between two far
// apart cards can visibly cut through an unrelated card in between, which
// reads as "this line connects to that card." This module answers, for one
// edge at a time: does the direct line cross anyone else's card, and if so,
// what's the shortest few-bend detour around them.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

// Obstacles are inflated by this much before any intersection test, so a
// routed line runs visibly clear of a card's edge rather than grazing it.
const OBSTACLE_MARGIN = 16;
// Obstacles further than this outside the source/target's own bounding box
// are irrelevant to routing between them — keeps the routing grid (and the
// pathfinding search over it) small regardless of how many unrelated nodes
// exist elsewhere in the chart.
const SEARCH_MARGIN = 140;
// Small cost added per direction change during pathfinding, so the router
// prefers one longer straight run over a shorter path with an extra bend.
const TURN_PENALTY = 40;
// Corner rounding applied when the routed path is turned into an SVG `d`
// string — matches ReportingEdge.tsx's primary-edge corner treatment so a
// routed secondary edge doesn't read as a visually distinct mechanism.
export const ROUTE_CORNER_RADIUS = 8;

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function inflate(rect: Rect, margin: number): Rect {
  return { x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 };
}

// True if the (necessarily axis-aligned, since every segment tested here is
// either horizontal, vertical, or the initial direct probe) segment crosses
// the STRICT interior of rect — touching an edge or corner doesn't count, so
// a routed path is allowed to run flush along an obstacle's boundary.
function segmentIntersectsRect(p1: Point, p2: Point, rect: Rect): boolean {
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  return minX < right && maxX > left && minY < bottom && maxY > top;
}

type Dir = 'h' | 'v' | null;

// Returns null when the direct source→target line doesn't cross any
// obstacle — the overwhelming common case, where callers should keep using
// their normal curve. Otherwise returns the intermediate bend points (never
// including source/target themselves — callers already have those exactly,
// from React Flow's own live handle geometry) of an orthogonal path that
// avoids every given obstacle.
export function routeAroundObstacles(source: Point, target: Point, allObstacles: Rect[]): Point[] | null {
  const searchBox: Rect = {
    x: Math.min(source.x, target.x) - SEARCH_MARGIN,
    y: Math.min(source.y, target.y) - SEARCH_MARGIN,
    width: Math.abs(target.x - source.x) + SEARCH_MARGIN * 2,
    height: Math.abs(target.y - source.y) + SEARCH_MARGIN * 2,
  };
  const obstacles = allObstacles.map((r) => inflate(r, OBSTACLE_MARGIN)).filter((r) => rectsOverlap(r, searchBox));

  const blocked = obstacles.some((r) => segmentIntersectsRect(source, target, r));
  if (!blocked) return null;

  const xsSet = new Set<number>([source.x, target.x]);
  const ysSet = new Set<number>([source.y, target.y]);
  for (const r of obstacles) {
    xsSet.add(r.x);
    xsSet.add(r.x + r.width);
    ysSet.add(r.y);
    ysSet.add(r.y + r.height);
  }
  const xs = [...xsSet].sort((a, b) => a - b);
  const ys = [...ysSet].sort((a, b) => a - b);

  function pointBlocked(x: number, y: number): boolean {
    return obstacles.some((r) => x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height);
  }
  function edgeClear(p1: Point, p2: Point): boolean {
    return !obstacles.some((r) => segmentIntersectsRect(p1, p2, r));
  }

  const xi = new Map(xs.map((x, i) => [x, i]));
  const yi = new Map(ys.map((y, i) => [y, i]));
  const key = (ix: number, iy: number, dir: Dir) => `${ix},${iy},${dir ?? '-'}`;
  const posOf = (ix: number, iy: number): Point => ({ x: xs[ix], y: ys[iy] });

  const startIx = xi.get(source.x)!;
  const startIy = yi.get(source.y)!;
  const goalIx = xi.get(target.x)!;
  const goalIy = yi.get(target.y)!;

  // Dijkstra over (x-index, y-index, incoming-direction) states — the
  // direction component is what lets a turn cost more than a straight run,
  // which is what keeps the result to a handful of bends instead of a
  // jagged shortest-path staircase.
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const startKey = key(startIx, startIy, null);
  dist.set(startKey, 0);
  const queue: string[] = [startKey];

  while (queue.length > 0) {
    queue.sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity));
    const current = queue.shift()!;
    const [ixStr, iyStr, dirStr] = current.split(',');
    const ix = Number(ixStr);
    const iy = Number(iyStr);
    const dir: Dir = dirStr === '-' ? null : (dirStr as Dir);
    const from = posOf(ix, iy);

    const neighbors: { ix: number; iy: number; dir: Dir }[] = [];
    if (ix > 0) neighbors.push({ ix: ix - 1, iy, dir: 'h' });
    if (ix < xs.length - 1) neighbors.push({ ix: ix + 1, iy, dir: 'h' });
    if (iy > 0) neighbors.push({ ix, iy: iy - 1, dir: 'v' });
    if (iy < ys.length - 1) neighbors.push({ ix, iy: iy + 1, dir: 'v' });

    for (const n of neighbors) {
      const to = posOf(n.ix, n.iy);
      if (pointBlocked(to.x, to.y) || !edgeClear(from, to)) continue;
      const stepDist = Math.hypot(to.x - from.x, to.y - from.y);
      const turnCost = dir !== null && n.dir !== dir ? TURN_PENALTY : 0;
      const nk = key(n.ix, n.iy, n.dir);
      const candidate = (dist.get(current) ?? Infinity) + stepDist + turnCost;
      if (candidate < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, candidate);
        prev.set(nk, current);
        queue.push(nk);
      }
    }
  }

  let bestGoalKey: string | null = null;
  for (const dir of ['h', 'v', null] as Dir[]) {
    const k = key(goalIx, goalIy, dir);
    if (dist.has(k) && (bestGoalKey === null || dist.get(k)! < dist.get(bestGoalKey)!)) bestGoalKey = k;
  }
  // No route through this local grid — every candidate corridor is blocked
  // (a tightly packed cluster of obstacles, say). Falling back to the plain
  // curve is a better outcome than no edge at all.
  if (bestGoalKey === null) return null;

  const pathKeys: string[] = [];
  let cur: string | null = bestGoalKey;
  while (cur !== null) {
    pathKeys.push(cur);
    cur = prev.get(cur) ?? null;
  }
  pathKeys.reverse();

  const points = pathKeys.map((k) => {
    const [ixStr, iyStr] = k.split(',');
    return posOf(Number(ixStr), Number(iyStr));
  });

  // Collapse collinear runs (a straight multi-cell hop is several grid edges
  // but only one visual segment).
  const simplified: Point[] = [];
  for (const p of points) {
    if (simplified.length >= 2) {
      const a = simplified[simplified.length - 2];
      const b = simplified[simplified.length - 1];
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) {
        simplified[simplified.length - 1] = p;
        continue;
      }
    }
    simplified.push(p);
  }

  return simplified.slice(1, -1);
}

// Turns an ordered [source, ...bends, target] point list into an SVG path
// with rounded corners — the same visual treatment
// getSmoothStepPath({ borderRadius }) gives primary edges, reimplemented by
// hand here since this path has an arbitrary number of bends rather than
// getSmoothStepPath's fixed shape.
export function roundedPolylinePath(points: Point[], radius: number): string {
  if (points.length < 2) return '';
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const toPrevLen = Math.max(Math.hypot(curr.x - prev.x, curr.y - prev.y), 1);
    const toNextLen = Math.max(Math.hypot(next.x - curr.x, next.y - curr.y), 1);
    const r = Math.min(radius, toPrevLen / 2, toNextLen / 2);

    const inPoint = { x: curr.x + ((prev.x - curr.x) / toPrevLen) * r, y: curr.y + ((prev.y - curr.y) / toPrevLen) * r };
    const outPoint = { x: curr.x + ((next.x - curr.x) / toNextLen) * r, y: curr.y + ((next.y - curr.y) / toNextLen) * r };

    d += ` L ${inPoint.x} ${inPoint.y} Q ${curr.x} ${curr.y} ${outPoint.x} ${outPoint.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}
