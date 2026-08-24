import { describe, expect, it } from 'vitest';
import {
  emptyTimeEstimationFilters,
  hasActiveTimeEstimationFilters,
  matchesTimeEstimationFilters,
  type FilterableLineItem,
  type TimeEstimationFilters,
} from './timeEstimationFilters';

function makeLineItem(overrides: Partial<FilterableLineItem> = {}): FilterableLineItem {
  return {
    clientMissionId: 'cm-1',
    employeeId: 'emp-1',
    remunerationModel: null,
    n1Total: null,
    actualByMonth: new Array(12).fill(null),
    venduNextYear: null,
    prevuNextYear: null,
    ...overrides,
  };
}

function withFilter(overrides: Partial<TimeEstimationFilters>): TimeEstimationFilters {
  return { ...emptyTimeEstimationFilters(), ...overrides };
}

describe('hasActiveTimeEstimationFilters', () => {
  it('is false for the empty filter set', () => {
    expect(hasActiveTimeEstimationFilters(emptyTimeEstimationFilters())).toBe(false);
  });

  it('is true once any single dimension has a selection', () => {
    expect(hasActiveTimeEstimationFilters(withFilter({ employeeIds: new Set(['emp-1']) }))).toBe(true);
  });
});

describe('matchesTimeEstimationFilters — client/mission and employee dimensions', () => {
  it('matches everything when no dimension is active', () => {
    const li = makeLineItem();
    expect(matchesTimeEstimationFilters(li, emptyTimeEstimationFilters())).toBe(true);
  });

  it('filters by clientMissionIds membership', () => {
    const li = makeLineItem({ clientMissionId: 'cm-1' });
    expect(matchesTimeEstimationFilters(li, withFilter({ clientMissionIds: new Set(['cm-1']) }))).toBe(true);
    expect(matchesTimeEstimationFilters(li, withFilter({ clientMissionIds: new Set(['cm-2']) }))).toBe(false);
  });

  it('filters by employeeIds membership', () => {
    const li = makeLineItem({ employeeId: 'emp-1' });
    expect(matchesTimeEstimationFilters(li, withFilter({ employeeIds: new Set(['emp-1']) }))).toBe(true);
    expect(matchesTimeEstimationFilters(li, withFilter({ employeeIds: new Set(['emp-2']) }))).toBe(false);
  });
});

describe('matchesTimeEstimationFilters — remuneration model dimension', () => {
  it('matches on the current-year model only', () => {
    const li = makeLineItem({ remunerationModel: 'retainer' });
    expect(matchesTimeEstimationFilters(li, withFilter({ remunerationModels: new Set(['retainer']) }))).toBe(true);
    expect(matchesTimeEstimationFilters(li, withFilter({ remunerationModels: new Set(['commission']) }))).toBe(false);
  });

  it('a row with no current-year model set never matches an active model filter', () => {
    const li = makeLineItem({ remunerationModel: null });
    expect(matchesTimeEstimationFilters(li, withFilter({ remunerationModels: new Set(['retainer']) }))).toBe(false);
  });
});

describe('matchesTimeEstimationFilters — actual-presence dimension', () => {
  it('n1 checks n1Total presence', () => {
    expect(matchesTimeEstimationFilters(makeLineItem({ n1Total: 50 }), withFilter({ actualPresence: new Set(['n1']) }))).toBe(true);
    expect(matchesTimeEstimationFilters(makeLineItem({ n1Total: null }), withFilter({ actualPresence: new Set(['n1']) }))).toBe(false);
  });

  it('n1 treats an exact 0 as absent, but a small nonzero value as present', () => {
    expect(matchesTimeEstimationFilters(makeLineItem({ n1Total: 0 }), withFilter({ actualPresence: new Set(['n1']) }))).toBe(false);
    expect(matchesTimeEstimationFilters(makeLineItem({ n1Total: 0.4 }), withFilter({ actualPresence: new Set(['n1']) }))).toBe(true);
  });

  it('n checks any non-null actualByMonth entry', () => {
    const months = new Array(12).fill(null);
    months[3] = 80;
    expect(matchesTimeEstimationFilters(makeLineItem({ actualByMonth: months }), withFilter({ actualPresence: new Set(['n']) }))).toBe(
      true,
    );
    expect(
      matchesTimeEstimationFilters(makeLineItem({ actualByMonth: new Array(12).fill(null) }), withFilter({ actualPresence: new Set(['n']) })),
    ).toBe(false);
  });

  it('n treats a month with an exact 0 as absent, not present — a real bug reproduced live: rows with only 0-valued actuals stayed visible', () => {
    const zeroMonths = new Array(12).fill(0);
    expect(matchesTimeEstimationFilters(makeLineItem({ actualByMonth: zeroMonths }), withFilter({ actualPresence: new Set(['n']) }))).toBe(
      false,
    );
    const smallMonths = new Array(12).fill(null);
    smallMonths[3] = 0.4;
    expect(
      matchesTimeEstimationFilters(makeLineItem({ actualByMonth: smallMonths }), withFilter({ actualPresence: new Set(['n']) })),
    ).toBe(true);
  });

  it('n1plus is reinterpreted as "N+1 forecast filled in", not a real actual', () => {
    expect(
      matchesTimeEstimationFilters(makeLineItem({ venduNextYear: 60 }), withFilter({ actualPresence: new Set(['n1plus']) })),
    ).toBe(true);
    expect(
      matchesTimeEstimationFilters(makeLineItem({ prevuNextYear: 40 }), withFilter({ actualPresence: new Set(['n1plus']) })),
    ).toBe(true);
    expect(
      matchesTimeEstimationFilters(
        makeLineItem({ venduNextYear: null, prevuNextYear: null }),
        withFilter({ actualPresence: new Set(['n1plus']) }),
      ),
    ).toBe(false);
  });

  it('n1plus treats exact-0 vendu/prevu as absent', () => {
    expect(
      matchesTimeEstimationFilters(
        makeLineItem({ venduNextYear: 0, prevuNextYear: 0 }),
        withFilter({ actualPresence: new Set(['n1plus']) }),
      ),
    ).toBe(false);
  });

  it('ORs across checked periods — matching any one is enough', () => {
    const li = makeLineItem({ n1Total: null, actualByMonth: new Array(12).fill(null), venduNextYear: 70 });
    expect(matchesTimeEstimationFilters(li, withFilter({ actualPresence: new Set(['n1', 'n', 'n1plus']) }))).toBe(true);
    expect(matchesTimeEstimationFilters(li, withFilter({ actualPresence: new Set(['n1', 'n']) }))).toBe(false);
  });
});

describe('matchesTimeEstimationFilters — combined dimensions', () => {
  it('ANDs across dimensions', () => {
    const li = makeLineItem({ clientMissionId: 'cm-1', employeeId: 'emp-1', remunerationModel: 'commission' });
    const filters = withFilter({ clientMissionIds: new Set(['cm-1']), remunerationModels: new Set(['commission']) });
    expect(matchesTimeEstimationFilters(li, filters)).toBe(true);

    const mismatched = withFilter({ clientMissionIds: new Set(['cm-1']), remunerationModels: new Set(['retainer']) });
    expect(matchesTimeEstimationFilters(li, mismatched)).toBe(false);
  });
});
