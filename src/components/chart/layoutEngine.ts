import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';
import { ROOT_GROUP_KEY } from './siblingOrder';

export const NODE_WIDTH = 220;
// Approximate spacing hint for dagre only — actual card height is
// content-driven (avatar row, dept pill, two ETP bars, advertisers,
// badge) and auto-measured by React Flow once mounted, same as NODE_WIDTH.
export const NODE_HEIGHT = 190;
// Shared with dagre's own `nodesep` graph option below so sibling reordering
// packs cards with the same gap dagre itself would have used.
const SIBLING_GAP = 32;

export function layoutWithDagre<T extends Node>(
  nodes: T[],
  edges: Edge[],
  // Drag-to-reorder support (siblingOrder.ts): when provided, read per-node
  // for every node in `nodes` after dagre's own layout runs, to reposition
  // same-parent siblings in a user-chosen left-to-right order. Omitted
  // callers (or every sibling returning null) get dagre's untouched output.
  siblingOrderOf?: (id: string) => number | null,
): T[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: SIBLING_GAP, ranksep: 64 });

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  if (siblingOrderOf) applySiblingOrder(g, nodes, edges, siblingOrderOf);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
    };
  });
}

// Dagre's own graphlib API has no per-node ordering/rank input — it computes
// horizontal order internally via its own crossing-minimization pass, with
// no supported way to constrain it. Enforcing a manual sibling order instead
// post-processes dagre's output, for each group of same-parent children
// where EVERY member has an explicit sibling_order (the backfill-on-first-
// touch invariant — a partially-null group is treated as untouched, dagre's
// own x stands).
//
// Two things a naive "just reorder the parents" pass gets wrong, both fixed
// here:
// 1. Repositioning a sibling must shift its ENTIRE subtree by the same
//    delta, not just its own box — otherwise a manager's whole team is left
//    behind at its old x while the manager moves, producing overlapping
//    subtrees (shiftDescendants below).
// 2. Different siblings can have very differently-sized subtrees (a manager
//    with 4 reports needs far more horizontal room than one with none).
//    Redistributing evenly across the group's original span, OR even just
//    permuting the original per-sibling slot x-positions, both assume
//    roughly equal subtree widths — swap a wide-subtree sibling into a
//    slot/gap sized for a narrow one and its descendants collide with the
//    neighboring subtree. The fix measures each sibling's own subtree's
//    current x-span first (before touching anything), then packs siblings
//    left-to-right in the new order using each one's ACTUAL measured width
//    plus a fixed gap — the same approach dagre itself uses, just applied to
//    whole subtrees instead of individual nodes. The packed block is
//    centered on the group's original average position, so a reorder moves
//    the cluster as little as possible rather than drifting the whole tree
//    sideways.
//
// Processing order between a group and its ancestor's group doesn't matter:
// each group's own width measurements and repositioning read whatever
// g.node(id).x currently is (possibly already shifted by an earlier-
// processed ancestor), and any further ancestor shift processed later
// cascades additively — so the net result is always "this node's own slot
// within its parent's group, plus the cumulative shift from every
// ancestor's own reordering," regardless of which group gets processed
// first.
function applySiblingOrder(
  g: dagre.graphlib.Graph,
  nodes: Node[],
  edges: Edge[],
  siblingOrderOf: (id: string) => number | null,
): void {
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    parentOf.set(e.target, e.source);
    const kids = childrenOf.get(e.source) ?? [];
    kids.push(e.target);
    childrenOf.set(e.source, kids);
  }

  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const key = parentOf.get(n.id) ?? ROOT_GROUP_KEY;
    const members = groups.get(key) ?? [];
    members.push(n.id);
    groups.set(key, members);
  }

  function shiftDescendants(id: string, delta: number) {
    for (const childId of childrenOf.get(id) ?? []) {
      g.node(childId).x += delta;
      shiftDescendants(childId, delta);
    }
  }

  function collectSubtree(id: string, acc: string[]) {
    acc.push(id);
    for (const childId of childrenOf.get(id) ?? []) collectSubtree(childId, acc);
  }

  for (const memberIds of groups.values()) {
    if (memberIds.length < 2) continue;
    if (memberIds.some((id) => siblingOrderOf(id) == null)) continue;

    // Measure each sibling's own subtree width in dagre's current output —
    // a leaf gets just its own card width; a manager with reports gets the
    // full span already occupied by everyone under them. Measuring before
    // any repositioning below means a uniform shift never distorts the
    // measurement (max - min is shift-invariant).
    const widthOf = new Map<string, number>();
    for (const id of memberIds) {
      const subtreeIds: string[] = [];
      collectSubtree(id, subtreeIds);
      const xs = subtreeIds.map((sid) => g.node(sid).x);
      widthOf.set(id, Math.max(...xs) - Math.min(...xs) + NODE_WIDTH);
    }

    const sorted = [...memberIds].sort((a, b) => siblingOrderOf(a)! - siblingOrderOf(b)!);
    const totalWidth = sorted.reduce((sum, id) => sum + widthOf.get(id)!, 0) + SIBLING_GAP * (sorted.length - 1);
    const originalCenter = memberIds.reduce((sum, id) => sum + g.node(id).x, 0) / memberIds.length;

    let cursor = originalCenter - totalWidth / 2;
    for (const id of sorted) {
      const width = widthOf.get(id)!;
      const oldX = g.node(id).x;
      const newX = cursor + width / 2;
      const delta = newX - oldX;
      g.node(id).x = newX;
      if (delta !== 0) shiftDescendants(id, delta);
      cursor += width + SIBLING_GAP;
    }
  }
}
