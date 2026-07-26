import { describe, expect, it } from 'vitest';
import {
  computeNewOrderValue,
  computeReorder,
  findDisplacementTargets,
  type ChartGeometry,
} from './siblingReorderGeometry';
import { NODE_WIDTH } from './layoutEngine';
import { ROOT_GROUP_KEY, SIBLING_ORDER_GAP } from './siblingOrder';

interface Spec {
  /** id -> committed layout x */
  x: Record<string, number>;
  /** id -> primary manager id; absent means a root */
  parent?: Record<string, string>;
  /** ids currently hidden by collapse or focus mode */
  hidden?: string[];
  /** id -> persisted sibling_order; absent means null (never reordered) */
  order?: Record<string, number>;
}

function geometry(spec: Spec): ChartGeometry {
  const allIds = Object.keys(spec.x);
  const parent = spec.parent ?? {};
  const hidden = new Set(spec.hidden ?? []);
  const children = new Map<string, string[]>();
  for (const [child, manager] of Object.entries(parent)) {
    children.set(manager, [...(children.get(manager) ?? []), child]);
  }
  return {
    allIds,
    groupKeyOf: (id) => parent[id] ?? ROOT_GROUP_KEY,
    visibleIds: new Set(allIds.filter((id) => !hidden.has(id))),
    baseXOf: (id) => spec.x[id] ?? 0,
    childrenOf: (id) => children.get(id) ?? [],
    siblingOrderOf: (id) => spec.order?.[id] ?? null,
  };
}

// Three siblings under one manager, evenly spaced, never manually reordered.
const trio = (): Spec => ({
  x: { boss: 250, a: 0, b: 250, c: 500 },
  parent: { a: 'boss', b: 'boss', c: 'boss' },
});

describe('computeNewOrderValue', () => {
  it('returns 0 for an empty group', () => {
    expect(computeNewOrderValue([], 0)).toBe(0);
  });

  it('goes a full gap below the first neighbour when dropped at the far left', () => {
    expect(computeNewOrderValue([1000, 2000], 0)).toBe(1000 - SIBLING_ORDER_GAP);
  });

  it('goes a full gap above the last neighbour when dropped at the far right', () => {
    expect(computeNewOrderValue([1000, 2000], 2)).toBe(2000 + SIBLING_ORDER_GAP);
  });

  it('takes the midpoint between the two new neighbours', () => {
    expect(computeNewOrderValue([1000, 2000], 1)).toBe(1500);
  });

  it('keeps splitting on repeated drops into the same slot', () => {
    // What makes fractional indexing work: an already-tight gap still has room.
    expect(computeNewOrderValue([1000, 1001], 1)).toBe(1000.5);
  });

  it('clamps an out-of-range index to the ends rather than returning NaN', () => {
    expect(computeNewOrderValue([1000], -5)).toBe(1000 - SIBLING_ORDER_GAP);
    expect(computeNewOrderValue([1000], 99)).toBe(1000 + SIBLING_ORDER_GAP);
  });
});

describe('computeReorder', () => {
  it('snaps back for an only child — there is no order to express', () => {
    const g = geometry({ x: { boss: 0, only: 0 }, parent: { only: 'boss' } });
    expect(computeReorder(g, 'only', 300)).toEqual({ kind: 'snap-back' });
  });

  it('snaps back when every other sibling is hidden', () => {
    const g = geometry({ ...trio(), hidden: ['b', 'c'] });
    expect(computeReorder(g, 'a', 250)).toEqual({ kind: 'snap-back' });
  });

  it('snaps back when dropped well outside the cluster (an attempted re-parent)', () => {
    const g = geometry(trio());
    expect(computeReorder(g, 'a', 500 + NODE_WIDTH + 1)).toEqual({ kind: 'snap-back' });
    expect(computeReorder(g, 'a', -NODE_WIDTH - 1)).toEqual({ kind: 'snap-back' });
  });

  it('accepts a drop just past the edge sibling, within the slack', () => {
    const g = geometry(trio());
    expect(computeReorder(g, 'a', 500 + NODE_WIDTH - 1).kind).toBe('reorder');
  });

  it('backfills the whole group on the first manual reorder', () => {
    const g = geometry(trio());
    // Drag `a` past `b` but short of `c`: new order b, a, c.
    const outcome = computeReorder(g, 'a', 300);
    if (outcome.kind !== 'reorder') throw new Error('expected a reorder');

    // Every member gets a value — a half-ordered group must never exist.
    expect(outcome.updates.map((u) => u.id).sort()).toEqual(['a', 'b', 'c']);

    const byId = new Map(outcome.updates.map((u) => [u.id, u.siblingOrder]));
    expect(byId.get('b')!).toBeLessThan(byId.get('a')!);
    expect(byId.get('a')!).toBeLessThan(byId.get('c')!);
  });

  it('backfills hidden siblings too, so the group never ends up half-ordered', () => {
    // `hidden` is in the group but collapsed out of view: it cannot be compared
    // geometrically, yet it must still receive a value.
    const g = geometry({
      x: { boss: 250, a: 0, b: 250, hidden: 500 },
      parent: { a: 'boss', b: 'boss', hidden: 'boss' },
      hidden: ['hidden'],
    });
    const outcome = computeReorder(g, 'a', 250);
    if (outcome.kind !== 'reorder') throw new Error('expected a reorder');
    expect(outcome.updates.map((u) => u.id).sort()).toEqual(['a', 'b', 'hidden']);
  });

  it('touches only the dragged row once the group is already ordered', () => {
    const g = geometry({
      ...trio(),
      order: { a: 1000, b: 2000, c: 3000 },
    });
    const outcome = computeReorder(g, 'a', 300);
    if (outcome.kind !== 'reorder') throw new Error('expected a reorder');
    expect(outcome.updates).toEqual([{ id: 'a', siblingOrder: 2500 }]);
  });

  it('moves a card to the far left of an ordered group', () => {
    const g = geometry({ ...trio(), order: { a: 1000, b: 2000, c: 3000 } });
    const outcome = computeReorder(g, 'c', -10);
    if (outcome.kind !== 'reorder') throw new Error('expected a reorder');
    expect(outcome.updates).toEqual([{ id: 'c', siblingOrder: 1000 - SIBLING_ORDER_GAP }]);
  });

  it('orders roots against each other, not just children', () => {
    const g = geometry({ x: { r1: 0, r2: 300 } });
    expect(computeReorder(g, 'r1', 300).kind).toBe('reorder');
  });

  it('ignores siblings from other managers', () => {
    // `other` sits at the same x as a real sibling but reports elsewhere, so it
    // must not participate — otherwise a drop could be measured against a card
    // from a different cluster entirely.
    const g = geometry({
      x: { boss: 0, otherBoss: 0, a: 0, b: 250, other: 250 },
      parent: { a: 'boss', b: 'boss', other: 'otherBoss' },
    });
    const outcome = computeReorder(g, 'a', 250);
    if (outcome.kind !== 'reorder') throw new Error('expected a reorder');
    expect(outcome.updates.map((u) => u.id).sort()).toEqual(['a', 'b']);
  });

  it('is idempotent: dropping a card back where it already is changes nothing meaningful', () => {
    const g = geometry({ ...trio(), order: { a: 1000, b: 2000, c: 3000 } });
    const outcome = computeReorder(g, 'b', 250);
    if (outcome.kind !== 'reorder') throw new Error('expected a reorder');
    const [update] = outcome.updates;
    expect(update.id).toBe('b');
    // Still between a and c.
    expect(update.siblingOrder).toBeGreaterThan(1000);
    expect(update.siblingOrder).toBeLessThan(3000);
  });
});

describe('findDisplacementTargets', () => {
  it('highlights nothing when there are no other visible siblings', () => {
    const g = geometry({ x: { boss: 0, only: 0 }, parent: { only: 'boss' } });
    expect(findDisplacementTargets(g, 'only', 100).size).toBe(0);
  });

  it('highlights nothing when dragged outside the cluster', () => {
    const g = geometry(trio());
    expect(findDisplacementTargets(g, 'a', 500 + NODE_WIDTH + 1).size).toBe(0);
  });

  it('highlights the nearest sibling', () => {
    const g = geometry(trio());
    expect([...findDisplacementTargets(g, 'a', 260)]).toEqual(['b']);
  });

  it('switches target as the drag crosses the midpoint', () => {
    const g = geometry(trio());
    expect([...findDisplacementTargets(g, 'a', 240)]).toEqual(['b']);
    expect([...findDisplacementTargets(g, 'a', 480)]).toEqual(['c']);
  });

  it('includes the displaced sibling’s whole subtree, not just their card', () => {
    const g = geometry({
      x: { boss: 250, a: 0, b: 250, b1: 200, b2: 300, b1a: 200 },
      parent: { a: 'boss', b: 'boss', b1: 'b', b2: 'b', b1a: 'b1' },
    });
    expect([...findDisplacementTargets(g, 'a', 250)].sort()).toEqual(['b', 'b1', 'b1a', 'b2']);
  });

  it('never disagrees with computeReorder about being inside the cluster', () => {
    // Both share isWithinGroupSpan, so a drop can't be accepted at a position
    // the live feedback had already rejected. Sweep across and past the span.
    const g = geometry(trio());
    for (let x = -NODE_WIDTH * 2; x <= 500 + NODE_WIDTH * 2; x += 25) {
      const accepted = computeReorder(g, 'a', x).kind === 'reorder';
      const highlighted = findDisplacementTargets(g, 'a', x).size > 0;
      expect(highlighted).toBe(accepted);
    }
  });
});
