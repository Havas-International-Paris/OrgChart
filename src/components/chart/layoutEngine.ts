import ELK from 'elkjs/lib/elk.bundled.js';
import type { Node, Edge } from '@xyflow/react';
import { ROOT_GROUP_KEY } from './siblingOrder';

export const NODE_WIDTH = 220;
// Compact mode (backlog item 51, narrowed further 2026-08-02) — about 30%
// narrower than the detailed card, on top of the shorter height, so the
// whole chart packs noticeably tighter. Same "elk spacing hint only, real
// size is auto-measured" caveat as COMPACT_NODE_HEIGHT below, and every
// layout helper that reasons about a card's own width (applySiblingOrder,
// centerParentsOverChildren, resolveOverlaps, packDisconnectedTrees) takes it
// as a parameter rather than reading the NODE_WIDTH constant directly, or
// their spacing math would silently stay sized for the wider detailed card.
export const COMPACT_NODE_WIDTH = 154;
// Approximate spacing hint for elk only — actual card height is
// content-driven (avatar row, dept pill, two ETP bars, advertisers,
// badge) and auto-measured by React Flow once mounted, same as NODE_WIDTH.
export const NODE_HEIGHT = 190;
// Compact mode (backlog item 51) drops the two ETP bars, advertiser list and
// subordinate badge from the card, so it's meaningfully shorter — this is
// only elk's spacing hint (real height is still auto-measured), but a stale
// hint would leave elk's vertical rank gap sized for the taller detailed
// card even when every card on screen is the shorter compact one.
export const COMPACT_NODE_HEIGHT = 100;
// Shared with elk's own nodeNode spacing option below so sibling reordering
// packs cards with the same gap elk itself would have used.
export const SIBLING_GAP = 32;
// elk's layered.spacing.nodeNodeBetweenLayers, kept equal to dagre's old
// ranksep so the parent/child vertical gap is unchanged (layoutEngine.test.ts
// asserts this exact value).
export const RANK_SEP = 64;
// Compact mode (backlog item 51, 2026-08-02) — shared by both axes on
// purpose: horizontal (siblingGap) and vertical (rankSep) spacing should
// match each other in compact mode, and tying both constants to this one
// value is what makes that a guarantee rather than two numbers someone has
// to remember to keep in sync. (An earlier version of this pass went the
// other way — raising the horizontal gap up to RANK_SEP's 64 instead of
// lowering the vertical gap down to this — which was backwards from what was
// actually wanted: a tighter compact chart on both axes, not just one.)
// Every layout parameter below that reads SIBLING_GAP/RANK_SEP takes it as
// an explicit argument (default to the detailed constant, so every other
// caller/test is unaffected), same reason nodeWidth/nodeHeight are threaded
// rather than read as module-level constants.
const COMPACT_GAP = 16;
export const COMPACT_SIBLING_GAP = COMPACT_GAP;
export const COMPACT_RANK_SEP = COMPACT_GAP;

const elk = new ELK();

type Position = { x: number; y: number };

// Tried elk's 'mrtree' algorithm (2026-07-30) to address a reported dead
// horizontal gap between sibling subtrees of very different sizes
// (Camille/Thierry/Nicolas de Vulpian screenshot) — 'layered' allocates each
// sibling's column by its own subtree's full width, so a childless sibling
// next to a large-subtree one leaves empty space between them. Measured live
// on the real ~42-person chart, fully expanded (.react-flow__node transform
// bounding box, not judged by eye): mrtree came out WIDER (4578px vs 4523px)
// and flatter (1332px vs 1524px tall) than 'layered' — the wrong direction
// entirely. mrtree has no crossing-minimization/compaction pass the way
// 'layered' does, so it fans children out rather than stacking them. Reverted
// to 'layered' below; if tried again, remeasure the same way rather than
// judging by eye — the visual "looks more compact" impression while zoomed
// out didn't match the actual measured footprint.
//
// Also tried 'elk.layered.compaction.postCompaction.strategy: EDGE_LENGTH'
// (same day, same measurement method) hoping it would shrink exactly that
// kind of unused lane width — zero effect, width identical to the pixel.
// Re-tried again (2026-08-01) against a genuinely disconnected chart
// (deleting the single root employee turns every one of their direct
// reports into their own separate root, with no path between them) on the
// theory that THAT was the disconnected case the option needed — still no
// effect, confirmed live: the several now-separate trees ended up not just
// far apart horizontally but at entirely different Y ranks too. That
// option only compacts nodes WITHIN one component's own layered graph; it
// has no bearing on how elk places separate components relative to each
// other (each component's own rank-0 lands at whatever Y elk's internal
// component-packing chose, not necessarily 0). Not re-enabled — see
// `packDisconnectedTrees` below instead, which replaces elk's own
// component placement outright rather than trying to steer it.

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
  // Compact mode (backlog item 51) passes the COMPACT_* constants here so
  // elk's own spacing tightens along with the smaller card — all four
  // default to the detailed card's dimensions so every other caller (tests
  // included) is unaffected.
  nodeHeight: number = NODE_HEIGHT,
  nodeWidth: number = NODE_WIDTH,
  siblingGap: number = SIBLING_GAP,
  rankSep: number = RANK_SEP,
): Promise<T[]> {
  if (nodes.length === 0) return [];

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(rankSep),
      'elk.spacing.nodeNode': String(siblingGap),
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
    children: nodes.map((n) => ({ id: n.id, width: nodeWidth, height: nodeHeight })),
    edges: edges.map((e) => ({ id: `${e.source}->${e.target}`, sources: [e.source], targets: [e.target] })),
  };

  const result = await elk.layout(graph);

  // elk positions are each child's top-left corner; dagre's were centres.
  // Converting to centre-space here lets applySiblingOrder's geometry (below)
  // stay untouched from its dagre days — it's converted back to top-left only
  // in the final map at the bottom of this function, exactly mirroring
  // dagre's own last step.
  const centerById = new Map<string, Position>(
    (result.children ?? []).map((c) => [c.id, { x: (c.x ?? 0) + nodeWidth / 2, y: (c.y ?? 0) + nodeHeight / 2 }]),
  );

  // Captured BEFORE any pass below mutates centerById, so the canonical
  // order's elk-order fallback (see computeCanonicalOrder) reflects elk's own
  // untouched output rather than a position a later pass already shifted.
  const rawXById = new Map<string, number>(nodes.map((n) => [n.id, centerById.get(n.id)!.x]));
  const orderIndex = computeCanonicalOrder(nodes, edges, rawXById, siblingOrderOf);

  // applySiblingOrder/centerParentsOverChildren/resolveOverlaps are all
  // rank-keyed (grouped by y) and naturally stay confined to one component
  // at a time on elk's own raw, unaligned output — different disconnected
  // trees essentially never share elk's own scattered y values, so nothing
  // here needs the trees pre-aligned to run correctly.
  if (siblingOrderOf) applySiblingOrder(centerById, nodes, edges, siblingOrderOf, nodeWidth, siblingGap);
  centerParentsOverChildren(centerById, nodes, edges, nodeWidth, siblingGap, orderIndex);
  resolveOverlaps(centerById, nodes, edges, nodeWidth, siblingGap, orderIndex);
  // Runs LAST, deliberately, not first: it measures each tree's bounding
  // box to decide how tightly to pack it against its neighbour, and the two
  // passes above can widen a tree's own true footprint after the fact (e.g.
  // resolving an internal overlap among wide-spread grandchildren pushes
  // that whole branch — and everything it's centred under — further out).
  // Measuring before they'd run once left the packed gap too small for the
  // tree's real, settled width, which read as leftover dead space once
  // everything else had finished moving (reported live, 2026-08-01).
  packDisconnectedTrees(centerById, nodes, edges, nodeWidth, siblingGap);

  return nodes.map((n) => {
    const pos = centerById.get(n.id)!;
    return {
      ...n,
      position: { x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 },
    };
  });
}

// elk treats every primary-edge tree with no path to any other (e.g. every
// former direct report of a just-deleted root employee, each now a root in
// their own right) as a separate connected component, and its own
// component-packing step places them with no relation to this app's idea of
// a sensible layout — confirmed live (2026-08-01, deleting the org's single
// root): the resulting trees ended up not just far apart horizontally but
// at entirely different Y ranks too, since each component's own rank-0 gets
// whatever Y elk's internal packing assigned it, not necessarily 0.
// `elk.layered.compaction.postCompaction.strategy` (see the comment near
// the top of this file) only compacts nodes WITHIN one component's own
// layered graph — it has no effect on this at all, which is why it
// measured as a no-op even against a genuinely disconnected chart.
//
// This pass replaces elk's own component placement outright: every
// primary-edge tree (found independently of elk, by walking from every
// root — a node with no primary manager — down through childrenOf) is
// treated as one rigid block and repositioned as a whole, so nothing about
// its own internal layout changes. Trees are realigned to a shared root-
// level Y (every tree's own rank-0 lines up) and packed left-to-right with
// the same gap used between ordinary siblings, preserving whatever
// left-to-right order the trees were already in (their own average X) —
// called LAST in layoutWithElk, after every other pass has already
// settled each tree's true final footprint, so the gap it packs is
// measured against real, final widths rather than elk's raw ones.
// A no-op whenever there's only one root — the overwhelming common case —
// so it changes nothing for a normal, fully-connected chart. Exported only
// so layoutEngine.test.ts can drive it directly against a crafted
// multi-root position map, same reasoning as resolveOverlaps below.
export function packDisconnectedTrees(
  positions: Map<string, Position>,
  nodes: Node[],
  edges: Edge[],
  nodeWidth: number = NODE_WIDTH,
  siblingGap: number = SIBLING_GAP,
): void {
  const childrenOf = new Map<string, string[]>();
  const hasPrimaryManager = new Set<string>();
  for (const e of edges) {
    const kids = childrenOf.get(e.source) ?? [];
    kids.push(e.target);
    childrenOf.set(e.source, kids);
    hasPrimaryManager.add(e.target);
  }

  const roots = nodes.map((n) => n.id).filter((id) => !hasPrimaryManager.has(id));
  if (roots.length < 2) return;

  function collectSubtree(id: string, acc: string[]) {
    acc.push(id);
    for (const childId of childrenOf.get(id) ?? []) collectSubtree(childId, acc);
  }

  const trees = roots.map((rootId) => {
    const memberIds: string[] = [];
    collectSubtree(rootId, memberIds);
    const xs = memberIds.map((id) => positions.get(id)!.x);
    const ys = memberIds.map((id) => positions.get(id)!.y);
    return {
      memberIds,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      avgX: xs.reduce((sum, x) => sum + x, 0) / xs.length,
    };
  });

  const sharedRootY = Math.min(...trees.map((t) => t.minY));
  const sorted = [...trees].sort((a, b) => a.avgX - b.avgX);

  let cursor = sorted[0].minX;
  for (const tree of sorted) {
    const dx = cursor - tree.minX;
    const dy = sharedRootY - tree.minY;
    if (dx !== 0 || dy !== 0) {
      for (const id of tree.memberIds) {
        const pos = positions.get(id)!;
        pos.x += dx;
        pos.y += dy;
      }
    }
    cursor += tree.maxX - tree.minX + nodeWidth + siblingGap;
  }
}

// Derives a single, whole-tree left-to-right ordering from structure alone
// (parent chain + sibling_order), independent of any pass's mutable x.
// centerParentsOverChildren/resolveOverlaps below sort each rank by this
// instead of by current x — sorting by x let one sibling group's own
// repacking (applySiblingOrder, below) silently scramble a DIFFERENT,
// unrelated branch's rank order. Real production case (reported by the user,
// 2026-08-25): Marcelo Gabriel Pedernera has sibling_order placing him last
// among Léa Lapébie's three children, and carries a 5-report team of his own
// — wide enough that packing him into the rightmost slot pushed his whole
// subtree past his own group's bounds, into the column belonging to a cousin
// branch several levels over (Antoine Panicucci, reached via a completely
// different lineage: Thierry Joly → Léa Furio → Antoine). Both team's cards
// ended up interleaved on the same rank. resolveOverlaps' adjacent-pair
// spacing fix couldn't help — it sorted that rank by current x, which was
// exactly the value applySiblingOrder had just scrambled, so it only spaced
// out whatever order the cards already ended up in rather than restoring the
// true one. Sorting by structure instead makes that scramble impossible:
// each parent's own children are ordered by explicit sibling_order when
// EVERY child has one (same backfill-on-first-touch rule applySiblingOrder
// itself uses below), else by elk's own raw x for that group (the
// pre-pass snapshot in rawXById, so a later pass's shifting can't
// retroactively change a group's fallback order). A pre-order DFS from every
// root assigns each node one incrementing index — nodes with no common
// ancestor still get a total order (root-to-root, by the same rule), so any
// rank can be sorted by one number instead of by position.
function computeCanonicalOrder(
  nodes: Node[],
  edges: Edge[],
  rawXById: Map<string, number>,
  siblingOrderOf?: (id: string) => number | null,
): Map<string, number> {
  const parentOf = new Map<string, string>();
  for (const e of edges) parentOf.set(e.target, e.source);

  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const key = parentOf.get(n.id) ?? ROOT_GROUP_KEY;
    const members = groups.get(key) ?? [];
    members.push(n.id);
    groups.set(key, members);
  }

  const sortedChildrenOf = new Map<string, string[]>();
  for (const [key, members] of groups) {
    const sorted =
      siblingOrderOf && members.every((id) => siblingOrderOf(id) != null)
        ? [...members].sort((a, b) => siblingOrderOf(a)! - siblingOrderOf(b)!)
        : [...members].sort((a, b) => rawXById.get(a)! - rawXById.get(b)!);
    sortedChildrenOf.set(key, sorted);
  }

  const orderIndex = new Map<string, number>();
  let counter = 0;
  function visit(id: string) {
    orderIndex.set(id, counter++);
    for (const childId of sortedChildrenOf.get(id) ?? []) visit(childId);
  }
  for (const rootId of sortedChildrenOf.get(ROOT_GROUP_KEY) ?? []) visit(rootId);

  return orderIndex;
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
  nodeWidth: number = NODE_WIDTH,
  siblingGap: number = SIBLING_GAP,
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
      widthOf.set(id, max - min + nodeWidth);
      oldCenterOf.set(id, (min + max) / 2);
    }

    const sorted = [...memberIds].sort((a, b) => siblingOrderOf(a)! - siblingOrderOf(b)!);
    const totalWidth = sorted.reduce((sum, id) => sum + widthOf.get(id)!, 0) + siblingGap * (sorted.length - 1);
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
      cursor += width + siblingGap;
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
//
// `orderIndex`, when supplied, sorts each rank by computeCanonicalOrder's
// structure-derived order rather than by current x before doing the adjacent-
// overlap push below — current x is exactly what an earlier pass
// (applySiblingOrder, for a wide-subtree sibling pushed to an outer slot) can
// have already scrambled across an unrelated branch's territory; sorting by
// x again here would just space out that scrambled order instead of
// restoring it. Optional and defaulting to an x-sort so the direct unit
// tests below (and any caller with no tree-wide order to give) keep their
// existing local-only behaviour.
function centerParentsOverChildren(
  positions: Map<string, Position>,
  nodes: Node[],
  edges: Edge[],
  nodeWidth: number = NODE_WIDTH,
  siblingGap: number = SIBLING_GAP,
  orderIndex?: Map<string, number>,
): void {
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

    const sorted = [...ids].sort((a, b) =>
      orderIndex ? orderIndex.get(a)! - orderIndex.get(b)! : positions.get(a)!.x - positions.get(b)!.x,
    );
    for (let i = 1; i < sorted.length; i += 1) {
      const prevRight = positions.get(sorted[i - 1])!.x + nodeWidth / 2;
      const currLeft = positions.get(sorted[i])!.x - nodeWidth / 2;
      const shortfall = siblingGap - (currLeft - prevRight);
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
//
// `orderIndex` is optional for the same reason and same fallback as
// centerParentsOverChildren's own — see that function's comment.
export function resolveOverlaps(
  positions: Map<string, Position>,
  nodes: Node[],
  edges: Edge[],
  nodeWidth: number = NODE_WIDTH,
  siblingGap: number = SIBLING_GAP,
  orderIndex?: Map<string, number>,
): void {
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
    const ids = idsByRank
      .get(y)!
      .sort((a, b) =>
        orderIndex ? orderIndex.get(a)! - orderIndex.get(b)! : positions.get(a)!.x - positions.get(b)!.x,
      );
    for (let i = 1; i < ids.length; i += 1) {
      const prevRight = positions.get(ids[i - 1])!.x + nodeWidth / 2;
      const currLeft = positions.get(ids[i])!.x - nodeWidth / 2;
      const shortfall = siblingGap - (currLeft - prevRight);
      if (shortfall > 0) shiftSubtree(ids[i], shortfall);
    }
  }
}
