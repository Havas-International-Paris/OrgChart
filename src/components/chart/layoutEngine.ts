import ELK from 'elkjs/lib/elk.bundled.js';
import type { Node, Edge } from '@xyflow/react';
import { ROOT_GROUP_KEY } from './siblingOrder';

export const NODE_WIDTH = 220;
// Approximate spacing hint for elk only — actual card height is
// content-driven (avatar row, dept pill, two ETP bars, advertisers,
// badge) and auto-measured by React Flow once mounted, same as NODE_WIDTH.
export const NODE_HEIGHT = 190;
// Shared with elk's own nodeNode spacing option below so sibling reordering
// packs cards with the same gap elk itself would have used.
const SIBLING_GAP = 32;
// elk's layered.spacing.nodeNodeBetweenLayers, kept equal to dagre's old
// ranksep so the parent/child vertical gap is unchanged (layoutEngine.test.ts
// asserts this exact value).
const RANK_SEP = 64;

const elk = new ELK();

type Position = { x: number; y: number };

// elk runs the actual layout algorithm asynchronously (elk.layout returns a
// Promise, even for the in-thread "bundled" build used here — there is no
// synchronous escape hatch), so every caller of this function now has to
// tolerate a real await instead of an immediate result. See useChartNodes.ts
// for how the async boundary is kept narrow: layoutedNodeById became state
// populated by an effect instead of a plain useMemo.
export async function layoutWithElk<T extends Node>(
  nodes: T[],
  edges: Edge[],
  // Drag-to-reorder support (siblingOrder.ts): when provided, read per-node
  // for every node in `nodes` after elk's own layout runs, to reposition
  // same-parent siblings in a user-chosen left-to-right order. Omitted
  // callers (or every sibling returning null) get elk's untouched output.
  siblingOrderOf?: (id: string) => number | null,
): Promise<T[]> {
  if (nodes.length === 0) return [];

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(RANK_SEP),
      'elk.spacing.nodeNode': String(SIBLING_GAP),
      // elk pads the whole graph by default; dagre didn't. Zeroing it out
      // keeps the coordinate space anchored the same way dagre's was.
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
      // Without this, elk's crossing-minimization can interleave one
      // manager's children with an unrelated sibling's cards on the same
      // rank (verified live) — visually confusing on its own, and it also
      // breaks the sibling-reorder width measurement below, which assumes a
      // subtree's own cards form one contiguous block. Preserving input
      // order keeps each manager's team together.
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: nodes.map((n) => ({ id: n.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: edges.map((e) => ({ id: `${e.source}->${e.target}`, sources: [e.source], targets: [e.target] })),
  };

  const result = await elk.layout(graph);

  // elk positions are each child's top-left corner; dagre's were centres.
  // Converting to centre-space here lets applySiblingOrder's geometry (below)
  // stay untouched from its dagre days — it's converted back to top-left only
  // in the final map at the bottom of this function, exactly mirroring
  // dagre's own last step.
  const centerById = new Map<string, Position>(
    (result.children ?? []).map((c) => [c.id, { x: (c.x ?? 0) + NODE_WIDTH / 2, y: (c.y ?? 0) + NODE_HEIGHT / 2 }]),
  );

  if (siblingOrderOf) applySiblingOrder(centerById, nodes, edges, siblingOrderOf);
  centerParentsOverChildren(centerById, nodes, edges);
  resolveOverlaps(centerById, nodes, edges);

  return nodes.map((n) => {
    const pos = centerById.get(n.id)!;
    return {
      ...n,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
    };
  });
}

// elk itself has no per-node ordering/rank input — it computes horizontal
// order internally via its own crossing-minimization pass, with no supported
// way to constrain it (same limitation dagre had). Enforcing a manual
// sibling order instead post-processes elk's output, for each group of
// same-parent children where EVERY member has an explicit sibling_order (the
// backfill-on-first-touch invariant — a partially-null group is treated as
// untouched, elk's own x stands).
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
//    plus a fixed gap — the same approach the layout engine itself uses, just
//    applied to whole subtrees instead of individual nodes. The packed block
//    is centered on the group's original average position, so a reorder
//    moves the cluster as little as possible rather than drifting the whole
//    tree sideways.
//
// Processing order between a group and its ancestor's group doesn't matter:
// each group's own width measurements and repositioning read whatever
// positions.get(id).x currently is (possibly already shifted by an earlier-
// processed ancestor), and any further ancestor shift processed later
// cascades additively — so the net result is always "this node's own slot
// within its parent's group, plus the cumulative shift from every
// ancestor's own reordering," regardless of which group gets processed
// first.
function applySiblingOrder(
  positions: Map<string, Position>,
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

  function collectSubtree(id: string, acc: string[]) {
    acc.push(id);
    for (const childId of childrenOf.get(id) ?? []) collectSubtree(childId, acc);
  }

  for (const memberIds of groups.values()) {
    if (memberIds.length < 2) continue;
    if (memberIds.some((id) => siblingOrderOf(id) == null)) continue;

    // Measure each sibling's own subtree's bounding box in elk's current
    // output — a leaf gets just its own card; a manager with reports gets
    // the full span already occupied by everyone under them. Measuring
    // before any repositioning below means a uniform shift never distorts
    // the measurement (max - min, and the span's centre, are both
    // shift-invariant). Cached per id since the shifting pass below reads
    // the same subtree ids and bounding box again.
    const subtreeIdsOf = new Map<string, string[]>();
    const widthOf = new Map<string, number>();
    const oldCenterOf = new Map<string, number>();
    for (const id of memberIds) {
      const subtreeIds: string[] = [];
      collectSubtree(id, subtreeIds);
      const xs = subtreeIds.map((sid) => positions.get(sid)!.x);
      const min = Math.min(...xs);
      const max = Math.max(...xs);
      subtreeIdsOf.set(id, subtreeIds);
      widthOf.set(id, max - min + NODE_WIDTH);
      oldCenterOf.set(id, (min + max) / 2);
    }

    const sorted = [...memberIds].sort((a, b) => siblingOrderOf(a)! - siblingOrderOf(b)!);
    const totalWidth = sorted.reduce((sum, id) => sum + widthOf.get(id)!, 0) + SIBLING_GAP * (sorted.length - 1);
    const originalCenter = memberIds.reduce((sum, id) => sum + positions.get(id)!.x, 0) / memberIds.length;

    // Each sibling's WHOLE subtree is translated as one rigid block so its
    // own bounding box lands at [cursor, cursor + width] — not just the
    // sibling's own card shifted by delta, with descendants dragged along
    // relative to it. That distinction matters here: dagre happened to
    // always centre a parent over its children, so shifting descendants by
    // the parent's own delta was equivalent to this. elk gives no such
    // guarantee (a manager's card can land anywhere relative to its own
    // team's span, including outside it — verified live), so anchoring the
    // shift to the parent's own old position could leave a subtree's actual
    // occupied span in the wrong slot even though the manager's own card
    // moved correctly. Anchoring to the subtree's own bounding-box centre
    // instead is what makes this correct regardless of the layout engine.
    let cursor = originalCenter - totalWidth / 2;
    for (const id of sorted) {
      const width = widthOf.get(id)!;
      const newCenter = cursor + width / 2;
      const delta = newCenter - oldCenterOf.get(id)!;
      if (delta !== 0) {
        for (const sid of subtreeIdsOf.get(id)!) positions.get(sid)!.x += delta;
      }
      cursor += width + SIBLING_GAP;
    }
  }
}

// dagre always centred a parent over its own direct children — never
// documented as a guarantee anywhere in this codebase because it never had
// to be, until the elk migration exposed that elk's node-placement strategies
// don't do this (confirmed live: a manager's card can land above one edge of
// its team's span rather than the middle — reported by the user with a
// 4-child manager sitting directly above its leftmost child instead of
// centred). Runs unconditionally, not just when applySiblingOrder touched
// anything, since the misplacement happens on elk's own untouched output too.
//
// Processed rank-by-rank, DEEPEST first (largest y down to smallest), and —
// this is the part that took a real test failure to get right — centring
// AND local overlap-resolution are interleaved WITHIN each rank's own turn,
// not run as two separate global passes. A first version centred every rank
// top-to-bottom (correct dependency order on its own) and then called the
// whole-graph resolveOverlaps once at the end: that pushed a card that had
// just been centred over (e.g.) 'wide' further away to avoid a genuine
// collision with 'solo', but nothing then re-centred 'wide' and 'solo''s own
// PARENT over their new, post-push positions — the parent stayed centred
// over where its children used to be. Recentring and resolving a rank's own
// internal overlaps immediately, before moving up to that rank's parent's
// turn, guarantees every rank a shallower one reads from is already truly
// final. `resolveOverlaps` (below) still runs once more after this, as a
// safety net for the one thing rank-local resolution can't see: a shifted
// subtree's descendants (moved by the same delta as their parent, so never
// misaligned from IT) landing on top of an unrelated cousin subtree several
// ranks down, which only a whole-graph pass can catch.
//
// Deliberately centres on the midpoint of children's own card positions
// (min+max)/2, not a width-weighted average — matches how a person visually
// judges "is this card centred over its team," and how dagre itself centred
// a parent, regardless of how much horizontal room any one child's own
// subtree occupies underneath it.
function centerParentsOverChildren(positions: Map<string, Position>, nodes: Node[], edges: Edge[]): void {
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    const kids = childrenOf.get(e.source) ?? [];
    kids.push(e.target);
    childrenOf.set(e.source, kids);
  }

  function shiftSubtree(id: string, delta: number) {
    positions.get(id)!.x += delta;
    for (const childId of childrenOf.get(id) ?? []) shiftSubtree(childId, delta);
  }

  const idsByRank = new Map<number, string[]>();
  for (const n of nodes) {
    const y = Math.round(positions.get(n.id)!.y);
    const members = idsByRank.get(y) ?? [];
    members.push(n.id);
    idsByRank.set(y, members);
  }

  const ranksDeepestFirst = [...idsByRank.keys()].sort((a, b) => b - a);
  for (const y of ranksDeepestFirst) {
    const ids = idsByRank.get(y)!;

    for (const id of ids) {
      const kids = childrenOf.get(id);
      if (!kids || kids.length === 0) continue;
      const xs = kids.map((kid) => positions.get(kid)!.x);
      positions.get(id)!.x = (Math.min(...xs) + Math.max(...xs)) / 2;
    }

    const sorted = [...ids].sort((a, b) => positions.get(a)!.x - positions.get(b)!.x);
    for (let i = 1; i < sorted.length; i += 1) {
      const prevRight = positions.get(sorted[i - 1])!.x + NODE_WIDTH / 2;
      const currLeft = positions.get(sorted[i])!.x - NODE_WIDTH / 2;
      const shortfall = SIBLING_GAP - (currLeft - prevRight);
      if (shortfall > 0) shiftSubtree(sorted[i], shortfall);
    }
  }
}

// Final safety net, always run — regardless of whether applySiblingOrder ran
// above. Real production data (found live: two same-rank, unreordered leaf
// cards — Mithun Prabhu Muthuraman / Juliette Roger — overlapping by ~17px,
// `sibling_order` confirmed null for both via a direct query) showed that
// elk's own `elk.spacing.nodeNode` option isn't a hard guarantee at this
// graph's scale (~50 employees, far more topology than the small fixtures in
// layoutEngine.test.ts): one adjacent pair on an otherwise perfectly
// 252px-pitched rank came out at 202.67px, a real ~49px shortfall with no
// sibling-reorder involved at all. Rather than chase why elk's internal
// compaction pass violated its own spacing option for this one pair, this
// walks every rank (grouped by y — elk's layered algorithm gives every node
// in a layer the identical y, since every node is given the same fixed
// height) left to right and pushes any card whose left edge is closer than
// SIBLING_GAP to its left neighbour's right edge, shifting its WHOLE subtree
// (not just its own card) by the shortfall — same shiftSubtree reasoning as
// applySiblingOrder above, since a leaf-only push wouldn't hold for a node
// with its own descendants. Ranks are processed shallow-to-deep so a shift
// applied to a shallow rank is already baked into `positions` by the time a
// deeper rank's own collision check runs.
// Exported only so layoutEngine.test.ts can drive it directly against a
// crafted overlapping position map — the real bug this fixes came from elk's
// own internal compaction pass at production scale, which a small unit-test
// fixture can't reliably reproduce on demand the way it can for
// applySiblingOrder above.
export function resolveOverlaps(positions: Map<string, Position>, nodes: Node[], edges: Edge[]): void {
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    const kids = childrenOf.get(e.source) ?? [];
    kids.push(e.target);
    childrenOf.set(e.source, kids);
  }

  function shiftSubtree(id: string, delta: number) {
    positions.get(id)!.x += delta;
    for (const childId of childrenOf.get(id) ?? []) shiftSubtree(childId, delta);
  }

  const idsByRank = new Map<number, string[]>();
  for (const n of nodes) {
    const y = Math.round(positions.get(n.id)!.y);
    const members = idsByRank.get(y) ?? [];
    members.push(n.id);
    idsByRank.set(y, members);
  }

  const ranks = [...idsByRank.keys()].sort((a, b) => a - b);
  for (const y of ranks) {
    const ids = idsByRank.get(y)!.sort((a, b) => positions.get(a)!.x - positions.get(b)!.x);
    for (let i = 1; i < ids.length; i += 1) {
      const prevRight = positions.get(ids[i - 1])!.x + NODE_WIDTH / 2;
      const currLeft = positions.get(ids[i])!.x - NODE_WIDTH / 2;
      const shortfall = SIBLING_GAP - (currLeft - prevRight);
      if (shortfall > 0) shiftSubtree(ids[i], shortfall);
    }
  }
}
