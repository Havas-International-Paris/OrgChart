import { describe, expect, it } from 'vitest';
import { computeReportingChain } from './useReportingChain';
import { dotted, manages } from '../../test/fixtures';

// Structure used throughout:
//
//   fmBoss            top
//      |               |
//     fm ····▶ mid ◀···· (fm's dotted line lands on mid)
//                |
//              leaf        dr ····▶ mid  (dr reports dotted to mid)
//
//   x is unrelated to everything.
const relationships = [
  manages('top', 'mid'),
  manages('mid', 'leaf'),
  manages('fmBoss', 'fm'),
  dotted('fm', 'mid'),
  dotted('mid', 'dr'),
  manages('top', 'x'),
];

const childrenOf = new Map<string, string[]>([
  ['top', ['mid', 'x']],
  ['mid', ['leaf']],
  ['fmBoss', ['fm']],
]);

const chainFor = (activeId: string | null) => computeReportingChain(activeId, relationships, childrenOf);

describe('computeReportingChain', () => {
  it('highlights nothing when no one is hovered or pinned', () => {
    const { relatedIds, chainIds } = chainFor(null);
    expect(relatedIds.size).toBe(0);
    expect(chainIds.size).toBe(0);
  });

  it('includes the active person', () => {
    expect(chainFor('mid').relatedIds).toContain('mid');
  });

  it('walks the primary tree all the way up', () => {
    expect(chainFor('leaf').relatedIds).toContain('top');
  });

  it('includes the whole descendant subtree', () => {
    expect(chainFor('top').relatedIds).toContain('leaf');
  });

  it('includes a dotted manager and that manager’s own ancestors', () => {
    const { relatedIds } = chainFor('mid');
    expect(relatedIds).toContain('fm');
    expect(relatedIds).toContain('fmBoss');
  });

  it('leaves unrelated branches out', () => {
    expect(chainFor('leaf').relatedIds).not.toContain('x');
  });

  // The one asymmetry between the two sets, and the reason they both exist:
  // an incoming dotted reporter's *card* stays lit, but it must not count as
  // a chain member, or unrelated edges hanging off it would light up too.
  it('lights an incoming dotted reporter’s card but keeps it out of chainIds', () => {
    const { relatedIds, chainIds } = chainFor('mid');
    expect(relatedIds).toContain('dr');
    expect(chainIds).not.toContain('dr');
  });

  it('puts ancestors and descendants in both sets', () => {
    const { relatedIds, chainIds } = chainFor('mid');
    for (const id of ['top', 'leaf', 'fm', 'fmBoss']) {
      expect(relatedIds).toContain(id);
      expect(chainIds).toContain(id);
    }
  });

  it('keeps chainIds a subset of relatedIds', () => {
    for (const id of ['top', 'mid', 'leaf', 'fm', 'dr', 'x']) {
      const { relatedIds, chainIds } = chainFor(id);
      for (const chainId of chainIds) expect(relatedIds).toContain(chainId);
    }
  });

  it('computes the exact set for the most connected node', () => {
    const { relatedIds } = chainFor('mid');
    expect([...relatedIds].sort()).toEqual(['dr', 'fm', 'fmBoss', 'leaf', 'mid', 'top']);
  });

  it('handles an id with no relationships at all', () => {
    const { relatedIds } = chainFor('ghost');
    expect([...relatedIds]).toEqual(['ghost']);
  });

  // The walk-up guard (`!chain.has(current)`) is what stops this hanging the
  // browser if corrupt data ever produces a primary loop.
  it('terminates on a cyclic primary chain', () => {
    const cyclic = [manages('a', 'b'), manages('b', 'a')];
    const { relatedIds } = computeReportingChain('a', cyclic, new Map());
    expect([...relatedIds].sort()).toEqual(['a', 'b']);
  });
});
