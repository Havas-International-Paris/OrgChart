import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { NODE_HEIGHT, NODE_WIDTH, layoutWithElk, packDisconnectedTrees, resolveOverlaps } from './layoutEngine';

// elk's layered.spacing.nodeNodeBetweenLayers, kept in sync with the graph
// options in layoutEngine.ts.
const RANK_SEP = 64;

const node = (id: string): Node => ({ id, position: { x: 0, y: 0 }, data: {} });
const edge = (source: string, target: string): Edge => ({ id: `${source}-${target}`, source, target });

function build(ids: string[], links: [string, string][]) {
  return { nodes: ids.map(node), edges: links.map(([s, t]) => edge(s, t)) };
}

const byId = (laid: Node[]) => new Map(laid.map((n) => [n.id, n.position]));

// Horizontal extent actually occupied by a subtree, in the same top-left
// coordinates React Flow renders. This is what must not overlap between two
// sibling subtrees — comparing the sibling cards alone would miss a manager
// whose team collides with the neighbour's.
function span(laid: Node[], subtreeIds: string[]) {
  const xs = subtreeIds.map((id) => byId(laid).get(id)!.x);
  return { left: Math.min(...xs), right: Math.max(...xs) + NODE_WIDTH };
}

const order = (map: Record<string, number>) => (id: string) => map[id] ?? null;

describe('layoutWithElk', () => {
  it('returns top-left positions, not elk’s centres', async () => {
    const { nodes, edges } = build(['solo'], []);
    const [laid] = await layoutWithElk(nodes, edges);
    // A lone node has no neighbours to be spaced against, so elk places its
    // top-left corner at the origin.
    expect(laid.position.x).toBeCloseTo(0);
    expect(laid.position.y).toBeCloseTo(0);
  });

  it('preserves every node and its other properties', async () => {
    const { nodes, edges } = build(['a', 'b'], [['a', 'b']]);
    const laid = await layoutWithElk(nodes, edges);
    expect(laid.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(laid[0].data).toEqual({});
  });

  it('places a report exactly one rank below its manager', async () => {
    const { nodes, edges } = build(['m', 'e'], [['m', 'e']]);
    const pos = byId(await layoutWithElk(nodes, edges));
    expect(pos.get('e')!.y - pos.get('m')!.y).toBeCloseTo(NODE_HEIGHT + RANK_SEP);
  });

  it('puts siblings on the same rank, side by side', async () => {
    const { nodes, edges } = build(['m', 'p', 'q'], [['m', 'p'], ['m', 'q']]);
    const pos = byId(await layoutWithElk(nodes, edges));
    expect(pos.get('p')!.y).toBeCloseTo(pos.get('q')!.y);
    expect(pos.get('p')!.x).not.toBeCloseTo(pos.get('q')!.x);
  });

  it('leaves elk’s own order alone when no sibling order is supplied', async () => {
    const { nodes, edges } = build(['m', 'p', 'q'], [['m', 'p'], ['m', 'q']]);
    const withoutArg = byId(await layoutWithElk(nodes, edges));
    const allNull = byId(await layoutWithElk(nodes, edges, () => null));
    expect(allNull.get('p')).toEqual(withoutArg.get('p'));
    expect(allNull.get('q')).toEqual(withoutArg.get('q'));
  });

  it('honours an explicit sibling order in both directions', async () => {
    const { nodes, edges } = build(['m', 'p', 'q'], [['m', 'p'], ['m', 'q']]);

    const qFirst = byId(await layoutWithElk(nodes, edges, order({ p: 2000, q: 1000 })));
    expect(qFirst.get('q')!.x).toBeLessThan(qFirst.get('p')!.x);

    const pFirst = byId(await layoutWithElk(nodes, edges, order({ p: 1000, q: 2000 })));
    expect(pFirst.get('p')!.x).toBeLessThan(pFirst.get('q')!.x);
  });

  it('orders roots too, not just children', async () => {
    const { nodes, edges } = build(['r1', 'r2'], []);
    const pos = byId(await layoutWithElk(nodes, edges, order({ r1: 2000, r2: 1000 })));
    expect(pos.get('r2')!.x).toBeLessThan(pos.get('r1')!.x);
  });

  // The backfill-on-first-touch invariant: a group is either fully ordered or
  // treated as untouched. A half-ordered group must fall back to elk rather
  // than packing the ordered members and stranding the rest.
  it('ignores a group where only some siblings have an order', async () => {
    const { nodes, edges } = build(['m', 'p', 'q'], [['m', 'p'], ['m', 'q']]);
    const baseline = byId(await layoutWithElk(nodes, edges));
    const partial = byId(await layoutWithElk(nodes, edges, order({ p: 1000 })));
    expect(partial.get('p')).toEqual(baseline.get('p'));
    expect(partial.get('q')).toEqual(baseline.get('q'));
  });

  it('leaves an only child where elk put it', async () => {
    const { nodes, edges } = build(['m', 'only'], [['m', 'only']]);
    const baseline = byId(await layoutWithElk(nodes, edges));
    const ordered = byId(await layoutWithElk(nodes, edges, order({ only: 1000 })));
    expect(ordered.get('only')).toEqual(baseline.get('only'));
  });

  it('drags a reordered manager’s whole subtree along with them', async () => {
    // m has two reports; `boss` carries a team of two, `solo` carries none.
    // Reordering must move boss's reports by boss's own delta, not leave them
    // behind at their old x.
    const { nodes, edges } = build(
      ['m', 'boss', 'solo', 'k1', 'k2'],
      [['m', 'boss'], ['m', 'solo'], ['boss', 'k1'], ['boss', 'k2']],
    );

    const before = byId(await layoutWithElk(nodes, edges, order({ boss: 1000, solo: 2000 })));
    const after = byId(await layoutWithElk(nodes, edges, order({ boss: 2000, solo: 1000 })));

    const bossDelta = after.get('boss')!.x - before.get('boss')!.x;
    expect(bossDelta).not.toBeCloseTo(0);
    expect(after.get('k1')!.x - before.get('k1')!.x).toBeCloseTo(bossDelta);
    expect(after.get('k2')!.x - before.get('k2')!.x).toBeCloseTo(bossDelta);
  });

  // The regression that took several passes to fix (backlog item 25): packing
  // siblings into evenly-sized slots, or permuting the layout engine's
  // original slot positions, both assume similar subtree widths. Moving a
  // wide subtree into a gap sized for a narrow one made its descendants
  // collide with the neighbouring subtree. Positions must be packed by each
  // subtree's real measured width instead.
  it('never overlaps sibling subtrees of very different widths', async () => {
    const { nodes, edges } = build(
      ['m', 'wide', 'n1', 'n2', 'w1', 'w2', 'w3', 'w4'],
      [
        ['m', 'wide'],
        ['m', 'n1'],
        ['m', 'n2'],
        ['wide', 'w1'],
        ['wide', 'w2'],
        ['wide', 'w3'],
        ['wide', 'w4'],
      ],
    );

    // Sandwich the wide subtree between the two narrow ones — the tightest case.
    const laid = await layoutWithElk(nodes, edges, order({ n1: 1000, wide: 2000, n2: 3000 }));

    const first = span(laid, ['n1']);
    const middle = span(laid, ['wide', 'w1', 'w2', 'w3', 'w4']);
    const last = span(laid, ['n2']);

    // Guard against a vacuous assertion: the middle subtree must really be
    // the wide one, or "no overlap" would prove nothing.
    expect(middle.right - middle.left).toBeGreaterThan((first.right - first.left) * 3);

    expect(first.right).toBeLessThanOrEqual(middle.left);
    expect(middle.right).toBeLessThanOrEqual(last.left);
  });

  it('keeps subtrees apart whichever slot the wide one is moved into', async () => {
    const { nodes, edges } = build(
      ['m', 'wide', 'n1', 'n2', 'w1', 'w2', 'w3', 'w4'],
      [
        ['m', 'wide'],
        ['m', 'n1'],
        ['m', 'n2'],
        ['wide', 'w1'],
        ['wide', 'w2'],
        ['wide', 'w3'],
        ['wide', 'w4'],
      ],
    );
    const wideSubtree = ['wide', 'w1', 'w2', 'w3', 'w4'];

    const arrangements: Record<string, number>[] = [
      { wide: 1000, n1: 2000, n2: 3000 },
      { n1: 1000, wide: 2000, n2: 3000 },
      { n1: 1000, n2: 2000, wide: 3000 },
    ];

    for (const arrangement of arrangements) {
      const laid = await layoutWithElk(nodes, edges, order(arrangement));
      const spans = Object.keys(arrangement)
        .sort((a, b) => arrangement[a] - arrangement[b])
        .map((id) => span(laid, id === 'wide' ? wideSubtree : [id]));

      for (let i = 1; i < spans.length; i += 1) {
        expect(spans[i - 1].right).toBeLessThanOrEqual(spans[i].left);
      }
    }
  });

  it('keeps a reordered group roughly where it was, rather than drifting sideways', async () => {
    const { nodes, edges } = build(['m', 'p', 'q', 'r'], [['m', 'p'], ['m', 'q'], ['m', 'r']]);
    const centreOf = (laid: Node[]) =>
      ['p', 'q', 'r'].reduce((sum, id) => sum + byId(laid).get(id)!.x, 0) / 3;

    const before = centreOf(await layoutWithElk(nodes, edges, order({ p: 1000, q: 2000, r: 3000 })));
    const after = centreOf(await layoutWithElk(nodes, edges, order({ p: 3000, q: 1000, r: 2000 })));
    expect(after).toBeCloseTo(before);
  });

  it('handles an empty chart', async () => {
    expect(await layoutWithElk([], [])).toEqual([]);
  });
});

// Real production bug (2026-07-30): two unreordered leaf cards on the same
// rank — Mithun Prabhu Muthuraman / Juliette Roger — overlapped by ~17px.
// `sibling_order` was confirmed null for both, so applySiblingOrder never ran
// for that pair; elk's own `elk.spacing.nodeNode` option turned out not to be
// a hard guarantee at production scale (~50 employees). resolveOverlaps is
// the always-on safety net added to catch this regardless of cause — these
// tests drive it directly against a crafted position map, since a small
// fixture can't reliably force elk's own compaction pass to reproduce the
// gap on demand the way the real graph did.
describe('resolveOverlaps', () => {
  it('pushes apart two same-rank cards closer than the sibling gap', () => {
    const nodes: Node[] = [node('a'), node('b')];
    // Mirrors the real numbers: 220-wide cards, gap of 202.67 instead of 252.
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 202.67, y: 0 }],
    ]);
    resolveOverlaps(positions, nodes, []);
    expect(positions.get('b')!.x - positions.get('a')!.x).toBeCloseTo(NODE_WIDTH + 32);
  });

  it('leaves correctly-spaced cards untouched', () => {
    const nodes: Node[] = [node('a'), node('b')];
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: NODE_WIDTH + 32, y: 0 }],
    ]);
    resolveOverlaps(positions, nodes, []);
    expect(positions.get('a')!.x).toBeCloseTo(0);
    expect(positions.get('b')!.x).toBeCloseTo(NODE_WIDTH + 32);
  });

  it('drags a pushed card’s whole subtree along with it, not just its own box', () => {
    // b has a child (c) on the rank below; pushing b apart from a must move
    // c by the same delta, or b would end up detached from its own subtree.
    const nodes: Node[] = [node('a'), node('b'), node('c')];
    const edges: Edge[] = [edge('b', 'c')];
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 100, y: 0 }],
      ['c', { x: 100, y: NODE_HEIGHT + 64 }],
    ]);
    resolveOverlaps(positions, nodes, edges);
    const delta = positions.get('b')!.x - 100;
    expect(delta).toBeGreaterThan(0);
    expect(positions.get('c')!.x - 100).toBeCloseTo(delta);
  });

  it('only pushes cards that share a rank (same y)', () => {
    const nodes: Node[] = [node('a'), node('b')];
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      // Same x as a real overlap would be, but a different rank — must be
      // left alone, since horizontal proximity across ranks isn't a
      // rendering collision.
      ['b', { x: 20, y: NODE_HEIGHT + 64 }],
    ]);
    resolveOverlaps(positions, nodes, []);
    expect(positions.get('b')!.x).toBeCloseTo(20);
  });
});

// Real user report (2026-08-01): deleting the org's single root employee
// turns every one of their direct reports into their own root, with no path
// between them — elk's own disconnected-component placement scattered the
// resulting trees both horizontally AND vertically (each tree's own rank-0
// landing at a different Y). packDisconnectedTrees replaces elk's placement
// outright; these tests drive it directly against a crafted multi-root
// position map, since a small fixture can't reliably force elk's own
// component-packing to reproduce the scatter on demand the way the real
// (much bigger) graph did.
describe('packDisconnectedTrees', () => {
  it('does nothing for a single-root graph — the overwhelming common case', () => {
    const nodes: Node[] = [node('m'), node('c')];
    const edges: Edge[] = [edge('m', 'c')];
    const positions = new Map([
      ['m', { x: 500, y: 300 }],
      ['c', { x: 500, y: 500 }],
    ]);
    packDisconnectedTrees(positions, nodes, edges);
    expect(positions.get('m')).toEqual({ x: 500, y: 300 });
    expect(positions.get('c')).toEqual({ x: 500, y: 500 });
  });

  it('realigns every tree’s own root rank to the same Y', () => {
    const nodes: Node[] = [node('r1'), node('r2')];
    const positions = new Map([
      ['r1', { x: 0, y: 0 }],
      // Scattered onto a totally different rank, as elk's own component
      // packing was found to do live.
      ['r2', { x: 900, y: 900 }],
    ]);
    packDisconnectedTrees(positions, nodes, []);
    expect(positions.get('r1')!.y).toBeCloseTo(positions.get('r2')!.y);
  });

  it('packs trees side by side with the standard sibling gap, no dead space', () => {
    const nodes: Node[] = [node('r1'), node('r2')];
    const positions = new Map([
      ['r1', { x: 0, y: 0 }],
      // Scattered far to the right, as elk's own component packing was
      // found to do live — nothing here should end up depending on that
      // raw distance.
      ['r2', { x: 3000, y: 900 }],
    ]);
    packDisconnectedTrees(positions, nodes, []);
    expect(positions.get('r2')!.x - positions.get('r1')!.x).toBeCloseTo(NODE_WIDTH + 32);
  });

  it('moves each tree as one rigid block — a subtree never gets left behind', () => {
    const nodes: Node[] = [node('r1'), node('r2'), node('c2')];
    const edges: Edge[] = [edge('r2', 'c2')];
    const positions = new Map([
      ['r1', { x: 0, y: 0 }],
      ['r2', { x: 3000, y: 900 }],
      ['c2', { x: 3000, y: 900 + NODE_HEIGHT + 64 }],
    ]);
    packDisconnectedTrees(positions, nodes, edges);
    const r2Delta = positions.get('r2')!.x - 3000;
    expect(r2Delta).not.toBeCloseTo(0);
    expect(positions.get('c2')!.x - 3000).toBeCloseTo(r2Delta);
    // c2's rank stays one below r2's, unaffected by the realignment.
    expect(positions.get('c2')!.y - positions.get('r2')!.y).toBeCloseTo(NODE_HEIGHT + 64);
  });

  it('never shrinks a wide tree’s own footprint into its neighbour', () => {
    // r1 is a lone card; r2 has four children spread wide beneath it — the
    // gap after r2 must respect r2's own measured span, not just its card.
    const nodes: Node[] = [node('r1'), node('r2'), node('c1'), node('c2'), node('c3'), node('c4')];
    const edges: Edge[] = [edge('r2', 'c1'), edge('r2', 'c2'), edge('r2', 'c3'), edge('r2', 'c4')];
    const positions = new Map([
      ['r1', { x: 0, y: 0 }],
      ['r2', { x: 1000, y: 0 }],
      ['c1', { x: 700, y: NODE_HEIGHT + 64 }],
      ['c2', { x: 900, y: NODE_HEIGHT + 64 }],
      ['c3', { x: 1100, y: NODE_HEIGHT + 64 }],
      ['c4', { x: 1300, y: NODE_HEIGHT + 64 }],
    ]);
    packDisconnectedTrees(positions, nodes, edges);
    const r2SubtreeLeft = Math.min(...['c1', 'c2', 'c3', 'c4'].map((id) => positions.get(id)!.x));
    expect(r2SubtreeLeft - (positions.get('r1')!.x + NODE_WIDTH)).toBeCloseTo(32);
  });
});

// Real user report (2026-07-30): a manager's card sat above its LEFTMOST
// child instead of centred over the whole team — unlike dagre, elk's own
// node-placement strategies don't guarantee a parent centres over its
// children. layoutWithElk now runs an unconditional centring pass (not
// gated on sibling reordering) fixing this on every layout, tested here
// through the public API since the whole point is to catch elk's own raw
// (unordered) output being off-centre, not just a reordered one.
describe('layoutWithElk parent centring', () => {
  it('centres a manager over the midpoint of several children', async () => {
    const { nodes, edges } = build(
      ['m', 'c1', 'c2', 'c3', 'c4'],
      [['m', 'c1'], ['m', 'c2'], ['m', 'c3'], ['m', 'c4']],
    );
    const pos = byId(await layoutWithElk(nodes, edges));
    const childXs = ['c1', 'c2', 'c3', 'c4'].map((id) => pos.get(id)!.x);
    const expectedCenter = (Math.min(...childXs) + Math.max(...childXs)) / 2;
    expect(pos.get('m')!.x).toBeCloseTo(expectedCenter);
  });

  it('still centres correctly when children have very different subtree widths', async () => {
    const { nodes, edges } = build(
      ['m', 'wide', 'solo', 'w1', 'w2', 'w3'],
      [['m', 'wide'], ['m', 'solo'], ['wide', 'w1'], ['wide', 'w2'], ['wide', 'w3']],
    );
    const pos = byId(await layoutWithElk(nodes, edges));
    const childXs = ['wide', 'solo'].map((id) => pos.get(id)!.x);
    const expectedCenter = (Math.min(...childXs) + Math.max(...childXs)) / 2;
    expect(pos.get('m')!.x).toBeCloseTo(expectedCenter);
  });

  it('centres every level of a multi-generation tree, deepest first', async () => {
    const { nodes, edges } = build(
      ['root', 'm1', 'm2', 'a', 'b', 'c', 'd'],
      [['root', 'm1'], ['root', 'm2'], ['m1', 'a'], ['m1', 'b'], ['m2', 'c'], ['m2', 'd']],
    );
    const pos = byId(await layoutWithElk(nodes, edges));

    const m1Center = (pos.get('a')!.x + pos.get('b')!.x) / 2;
    const m2Center = (pos.get('c')!.x + pos.get('d')!.x) / 2;
    expect(pos.get('m1')!.x).toBeCloseTo(m1Center);
    expect(pos.get('m2')!.x).toBeCloseTo(m2Center);

    const rootCenter = (pos.get('m1')!.x + pos.get('m2')!.x) / 2;
    expect(pos.get('root')!.x).toBeCloseTo(rootCenter);
  });
});
