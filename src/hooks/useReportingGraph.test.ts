import { describe, expect, it } from 'vitest';
import { wouldCreateCycle } from './useReportingGraph';
import { dotted, manages } from '../test/fixtures';

// The client-side half of the deliberately-doubled cycle prevention (the other
// half is the recursive-CTE trigger in 0003_cycle_check_function.sql). This is
// what greys out invalid choices live in the UI, so a false negative here lets
// the user attempt a write the database will reject — and a false positive
// silently forbids a legitimate reporting line.
//
// Reading the fixtures: manages('a', 'b') means "a is b's manager".
// wouldCreateCycle(rels, employeeId, managerId) asks "if managerId became a
// manager of employeeId, would that close a loop?"
describe('wouldCreateCycle', () => {
  it('rejects making someone their own manager', () => {
    expect(wouldCreateCycle([], 'a', 'a')).toBe(true);
  });

  it('rejects a direct swap of an existing link', () => {
    const rels = [manages('a', 'b')];
    expect(wouldCreateCycle(rels, 'a', 'b')).toBe(true);
  });

  it('rejects closing a loop several levels up', () => {
    const rels = [manages('a', 'b'), manages('b', 'c')];
    expect(wouldCreateCycle(rels, 'a', 'c')).toBe(true);
  });

  it('allows a second link down the same branch', () => {
    // a → b → c already exists; also making a a (secondary) manager of c is
    // redundant but not circular, and must stay selectable.
    const rels = [manages('a', 'b'), manages('b', 'c')];
    expect(wouldCreateCycle(rels, 'c', 'a')).toBe(false);
  });

  it('allows linking two unrelated people', () => {
    const rels = [manages('a', 'b')];
    expect(wouldCreateCycle(rels, 'c', 'd')).toBe(false);
  });

  it('allows a fresh link when the graph is empty', () => {
    expect(wouldCreateCycle([], 'a', 'b')).toBe(false);
  });

  // Matters because the walk must not be restricted to the primary tree: a
  // loop closed through a dotted line is just as invalid, and the Postgres
  // trigger doesn't distinguish either.
  it('walks dotted lines too, not just the primary tree', () => {
    const rels = [dotted('m', 'e'), manages('top', 'm')];
    expect(wouldCreateCycle(rels, 'top', 'e')).toBe(true);
  });

  it('follows every branch when an employee has several managers', () => {
    // e reports primarily to m1 and dotted to m2; only the m1 branch leads
    // back to top, so a breadth-first walk that stopped at the first branch
    // would miss it.
    const rels = [manages('m1', 'e'), dotted('m2', 'e'), manages('top', 'm1')];
    expect(wouldCreateCycle(rels, 'top', 'e')).toBe(true);
  });

  it('does not report a cycle for a diamond', () => {
    // Two managers sharing one grandmanager is legal multi-reporting.
    const rels = [manages('top', 'm1'), manages('top', 'm2'), manages('m1', 'e'), dotted('m2', 'e')];
    expect(wouldCreateCycle(rels, 'e', 'top')).toBe(false);
  });

  // Should be impossible given the trigger, but the visited set is what keeps
  // the walk from hanging the browser if corrupt data ever gets in.
  it('terminates on already-cyclic data instead of looping forever', () => {
    const rels = [manages('a', 'b'), manages('b', 'a')];
    expect(wouldCreateCycle(rels, 'x', 'a')).toBe(false);
  });
});
