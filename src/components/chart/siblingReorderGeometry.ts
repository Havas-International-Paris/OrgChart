import { NODE_WIDTH } from './layoutEngine';
import { ROOT_GROUP_KEY, SIBLING_ORDER_GAP } from './siblingOrder';

// The pure geometry behind drag-to-reorder, extracted from OrgChartView's two
// drag handlers so it can be unit-tested. This is the logic that took several
// passes to get right (backlog item 25); leaving it inline inside a useCallback
// meant it could only ever be checked by hand, in a browser, one drag at a time.
//
// Nothing here touches React, dagre or the DB. Both entry points take the
// chart's current geometry as plain lookups and return a decision:
//   computeReorder          — what to persist when a drag is released
//   findDisplacementTargets — who to highlight mid-drag as about-to-be-displaced
//
// Both deliberately share `isWithinGroupSpan`, so a drop can never be accepted
// at a position the live feedback had already rejected (and vice versa).

export interface ChartGeometry {
  /** Every employee id in the chart, in the order the layout used. */
  allIds: readonly string[];
  /** Primary manager id, or ROOT_GROUP_KEY for someone with no primary manager. */
  groupKeyOf: (id: string) => string;
  /** Currently on-screen ids (after expand/collapse and focus mode). */
  visibleIds: ReadonlySet<string>;
  /** Committed layout x of a card — never the live drag position. */
  baseXOf: (id: string) => number;
  /** Direct primary reports, for walking a displaced sibling's subtree. */
  childrenOf: (id: string) => readonly string[];
  /** Persisted manual order, or null if this group was never reordered. */
  siblingOrderOf: (id: string) => number | null;
}

export type ReorderOutcome =
  | { kind: 'snap-back' }
  | { kind: 'reorder'; updates: { id: string; siblingOrder: number }[] };

// A little slack past the cluster's own span still counts as "within this
// group" — dragging slightly past an edge sibling shouldn't read as leaving the
// cluster. Further than that is an invalid re-parent attempt, out of scope for
// this gesture (that's ReportingEdge's grip drag).
const SLACK = NODE_WIDTH;

function isWithinGroupSpan(droppedX: number, otherXs: number[]): boolean {
  if (otherXs.length === 0) return false;
  return droppedX >= Math.min(...otherXs) - SLACK && droppedX <= Math.max(...otherXs) + SLACK;
}

function groupMemberIds(geometry: ChartGeometry, employeeId: string): string[] {
  const key = geometry.groupKeyOf(employeeId) ?? ROOT_GROUP_KEY;
  return geometry.allIds.filter((id) => (geometry.groupKeyOf(id) ?? ROOT_GROUP_KEY) === key);
}

/**
 * Given a sibling group's OTHER members' sibling_order values (ascending, never
 * including the dragged node itself) and the index the dragged node should land
 * at (0..length), returns its new value: the midpoint of its two new
 * neighbours, or ±SIBLING_ORDER_GAP past whichever end it was dropped at.
 * Classic fractional/gap indexing — lets a later reorder in an already-
 * backfilled group touch only the dragged row.
 */
export function computeNewOrderValue(sortedNeighbors: readonly number[], index: number): number {
  if (sortedNeighbors.length === 0) return 0;
  if (index <= 0) return sortedNeighbors[0] - SIBLING_ORDER_GAP;
  if (index >= sortedNeighbors.length) return sortedNeighbors[sortedNeighbors.length - 1] + SIBLING_ORDER_GAP;
  return (sortedNeighbors[index - 1] + sortedNeighbors[index]) / 2;
}

/**
 * Decides what a released drag means. Reordering is only ever within one
 * sibling group (same primary manager, or both roots) — never a re-parent — so
 * anything dropped outside the dragged card's own cluster is a no-op that snaps
 * back.
 */
export function computeReorder(
  geometry: ChartGeometry,
  employeeId: string,
  droppedX: number,
): ReorderOutcome {
  const members = groupMemberIds(geometry, employeeId);
  if (members.length < 2) return { kind: 'snap-back' };

  // Only currently-visible siblings have a real on-screen x to compare against.
  // Hidden ones (collapsed elsewhere) can't be tested geometrically but still
  // get backfilled below, since the whole group must stay consistent.
  const visibleMembers = members.filter((id) => id === employeeId || geometry.visibleIds.has(id));
  if (visibleMembers.length < 2) return { kind: 'snap-back' };

  const otherXs = visibleMembers.filter((id) => id !== employeeId).map(geometry.baseXOf);
  if (!isWithinGroupSpan(droppedX, otherXs)) return { kind: 'snap-back' };

  const xOf = (id: string) => (id === employeeId ? droppedX : geometry.baseXOf(id));

  // Step 1: make sure every member of the FULL group (visible or not) has a
  // real sibling_order, backfilling from natural (dagre) order the first time
  // this group is ever manually touched. A partially-ordered group cannot
  // happen — that is the invariant this preserves.
  const untouched = members.every((id) => geometry.siblingOrderOf(id) == null);
  const orderById = new Map<string, number>();
  if (untouched) {
    [...members]
      .sort((a, b) => geometry.baseXOf(a) - geometry.baseXOf(b))
      .forEach((id, i) => orderById.set(id, (i + 1) * SIBLING_ORDER_GAP));
  } else {
    for (const id of members) orderById.set(id, geometry.siblingOrderOf(id) ?? 0);
  }

  // Step 2: derive the dragged node's new value from where it landed among the
  // (now numeric) VISIBLE siblings only.
  const sortedVisible = [...visibleMembers].sort((a, b) => xOf(a) - xOf(b));
  const draggedIndex = sortedVisible.indexOf(employeeId);
  const neighborValues = sortedVisible
    .filter((id) => id !== employeeId)
    .map((id) => orderById.get(id)!);
  const newValue = computeNewOrderValue(neighborValues, draggedIndex);
  orderById.set(employeeId, newValue);

  return {
    kind: 'reorder',
    updates: untouched
      ? [...orderById.entries()].map(([id, siblingOrder]) => ({ id, siblingOrder }))
      : [{ id: employeeId, siblingOrder: newValue }],
  };
}

/**
 * Live mid-drag feedback: whichever visible sibling is nearest the dragged
 * card's current x is the one about to be displaced, along with their whole
 * subtree. Read-only — never writes an order, and never disagrees with
 * computeReorder about whether the position is inside the group at all.
 */
export function findDisplacementTargets(
  geometry: ChartGeometry,
  employeeId: string,
  droppedX: number,
): Set<string> {
  const others = groupMemberIds(geometry, employeeId).filter(
    (id) => id !== employeeId && geometry.visibleIds.has(id),
  );
  if (others.length === 0) return new Set();
  if (!isWithinGroupSpan(droppedX, others.map(geometry.baseXOf))) return new Set();

  let nearestId = others[0];
  let nearestDist = Math.abs(geometry.baseXOf(nearestId) - droppedX);
  for (const id of others) {
    const dist = Math.abs(geometry.baseXOf(id) - droppedX);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestId = id;
    }
  }

  const targets = new Set<string>([nearestId]);
  const collect = (id: string) => {
    for (const childId of geometry.childrenOf(id)) {
      if (targets.has(childId)) continue;
      targets.add(childId);
      collect(childId);
    }
  };
  collect(nearestId);
  return targets;
}
