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

// Shared by computeReorder and findDisplacementTargets so they can never
// disagree about WHETHER the dragged card's rank has actually changed — the
// live yellow highlight and the drop's real effect must describe the exact
// same outcome, or the highlight is a lie the user can't trust. Sorts the
// dragged card's visible siblings by their real (committed) x, once with the
// dragged card at its own pre-drag x (`originalIndex`) and once with it at
// an EFFECTIVE x (`newIndex`) — a rank flip fires once the dragged card
// covers roughly HALF of a neighbour's card, not once it has fully passed
// it: shifting the dragged card's own sort key half a card-width further in
// whichever direction it's actually moving (from its last committed x) makes
// the sort flip exactly at that 50%-overlap point, rather than requiring the
// two cards' positions to nearly coincide. Direction is measured from the
// card's own committed x, not `originalIndex` (a rank, not a position) — a
// card can keep the same rank while still having moved, e.g. within a group
// of 4+ siblings.
function draggedRank(
  geometry: ChartGeometry,
  visibleMembers: readonly string[],
  employeeId: string,
  droppedX: number,
): { sortedVisible: string[]; originalIndex: number; newIndex: number } {
  const originalSorted = [...visibleMembers].sort((a, b) => geometry.baseXOf(a) - geometry.baseXOf(b));
  const committedX = geometry.baseXOf(employeeId);
  const direction = Math.sign(droppedX - committedX);
  const effectiveX = droppedX + direction * (NODE_WIDTH / 2);
  const xOf = (id: string) => (id === employeeId ? effectiveX : geometry.baseXOf(id));
  const sortedVisible = [...visibleMembers].sort((a, b) => xOf(a) - xOf(b));
  return {
    sortedVisible,
    originalIndex: originalSorted.indexOf(employeeId),
    newIndex: sortedVisible.indexOf(employeeId),
  };
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

  const { sortedVisible, originalIndex, newIndex } = draggedRank(geometry, visibleMembers, employeeId, droppedX);
  // The dragged card hasn't actually crossed anyone yet — same boundary
  // findDisplacementTargets uses to decide whether to highlight anyone at
  // all, so a drop here must agree and be a no-op rather than a silent,
  // meaningless DB write (and a "Réordonner" undo entry for nothing).
  if (newIndex === originalIndex) return { kind: 'snap-back' };

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
  const neighborValues = sortedVisible
    .filter((id) => id !== employeeId)
    .map((id) => orderById.get(id)!);
  const newValue = computeNewOrderValue(neighborValues, newIndex);
  orderById.set(employeeId, newValue);

  return {
    kind: 'reorder',
    updates: untouched
      ? [...orderById.entries()].map(([id, siblingOrder]) => ({ id, siblingOrder }))
      : [{ id: employeeId, siblingOrder: newValue }],
  };
}

/**
 * Live mid-drag feedback: whichever visible siblings the dragged card has
 * actually crossed rank with — i.e. exactly the set computeReorder would
 * reorder if released right now — get highlighted, along with each one's own
 * subtree. Read-only — never writes an order. Deliberately shares
 * `draggedRank` with computeReorder (not just `isWithinGroupSpan`) so a
 * released drop can never disagree with what was just highlighted: nobody
 * highlighted means a release here is a no-op, and releasing always resolves
 * to precisely the highlighted card(s) changing rank with the dragged one.
 */
export function findDisplacementTargets(
  geometry: ChartGeometry,
  employeeId: string,
  droppedX: number,
): Set<string> {
  const members = groupMemberIds(geometry, employeeId);
  const visibleMembers = members.filter((id) => id === employeeId || geometry.visibleIds.has(id));
  const others = visibleMembers.filter((id) => id !== employeeId);
  if (others.length === 0) return new Set();
  if (!isWithinGroupSpan(droppedX, others.map(geometry.baseXOf))) return new Set();

  const { sortedVisible, originalIndex, newIndex } = draggedRank(geometry, visibleMembers, employeeId, droppedX);
  if (newIndex === originalIndex) return new Set();

  const [lo, hi] = originalIndex < newIndex ? [originalIndex, newIndex] : [newIndex, originalIndex];
  const crossed = sortedVisible.slice(lo, hi + 1).filter((id) => id !== employeeId);

  const targets = new Set<string>(crossed);
  const collect = (id: string) => {
    for (const childId of geometry.childrenOf(id)) {
      if (targets.has(childId)) continue;
      targets.add(childId);
      collect(childId);
    }
  };
  for (const id of crossed) collect(id);
  return targets;
}
