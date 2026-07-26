import { describe, expect, it } from 'vitest';
import { computeVisibleGraph } from './useVisibleGraph';
import { emp, manages } from '../../test/fixtures';

const ids = (employees: { id: string }[]) => employees.map((e) => e.id).sort();

// a → b → c, plus an unattached root z.
const employees = [emp('a'), emp('b'), emp('c'), emp('z')];
const edges = [manages('a', 'b'), manages('b', 'c')];

describe('computeVisibleGraph', () => {
  it('treats everyone without a primary manager as a root', () => {
    const { roots } = computeVisibleGraph(employees, edges, new Set());
    expect(ids(roots)).toEqual(['a', 'z']);
  });

  it('shows only roots when nothing is expanded', () => {
    const { visibleEmployees } = computeVisibleGraph(employees, edges, new Set());
    expect(ids(visibleEmployees)).toEqual(['a', 'z']);
  });

  it('reveals one level per expanded node', () => {
    const oneLevel = computeVisibleGraph(employees, edges, new Set(['a']));
    expect(ids(oneLevel.visibleEmployees)).toEqual(['a', 'b', 'z']);

    const twoLevels = computeVisibleGraph(employees, edges, new Set(['a', 'b']));
    expect(ids(twoLevels.visibleEmployees)).toEqual(['a', 'b', 'c', 'z']);
  });

  // The reason focus mode can only ever hide, never force-reveal: expanding a
  // node whose own ancestor is collapsed changes nothing, because the walk
  // never reaches it.
  it('ignores an expanded node that a collapsed ancestor hides', () => {
    const { visibleEmployees } = computeVisibleGraph(employees, edges, new Set(['b']));
    expect(ids(visibleEmployees)).toEqual(['a', 'z']);
  });

  it('exposes children keyed by manager', () => {
    const { childrenOf } = computeVisibleGraph(employees, edges, new Set());
    expect(childrenOf.get('a')).toEqual(['b']);
    expect(childrenOf.get('c')).toBeUndefined();
  });

  it('groups several children under the same manager', () => {
    const team = [emp('boss'), emp('x'), emp('y')];
    const rels = [manages('boss', 'x'), manages('boss', 'y')];
    const { visibleEmployees, childrenOf } = computeVisibleGraph(team, rels, new Set(['boss']));
    expect(ids(visibleEmployees)).toEqual(['boss', 'x', 'y']);
    expect(childrenOf.get('boss')?.sort()).toEqual(['x', 'y']);
  });

  // The count feeds a collapsed node's badge, so it must describe the whole
  // subtree rather than what happens to be on screen — otherwise the number
  // would shift as the user expands unrelated branches.
  it('counts descendants over the full tree, regardless of what is expanded', () => {
    const collapsed = computeVisibleGraph(employees, edges, new Set());
    const expanded = computeVisibleGraph(employees, edges, new Set(['a', 'b']));
    for (const graph of [collapsed, expanded]) {
      expect(graph.totalDescendantCountOf('a')).toBe(2);
      expect(graph.totalDescendantCountOf('b')).toBe(1);
      expect(graph.totalDescendantCountOf('c')).toBe(0);
      expect(graph.totalDescendantCountOf('z')).toBe(0);
    }
  });

  it('returns 0 descendants for an unknown id', () => {
    const { totalDescendantCountOf } = computeVisibleGraph(employees, edges, new Set());
    expect(totalDescendantCountOf('nope')).toBe(0);
  });

  // Can happen transiently: the employees and relationships hooks refetch
  // independently, so an edge can name a child the employee list hasn't got
  // yet. It must be skipped, not crash or insert an undefined node.
  it('skips an edge pointing at an employee that is not loaded', () => {
    const partial = [emp('a')];
    const { visibleEmployees } = computeVisibleGraph(partial, edges, new Set(['a']));
    expect(ids(visibleEmployees)).toEqual(['a']);
  });

  it('handles an empty org chart', () => {
    const { visibleEmployees, roots } = computeVisibleGraph([], [], new Set());
    expect(visibleEmployees).toEqual([]);
    expect(roots).toEqual([]);
  });
});
