import { describe, expect, it } from 'vitest';
import {
  averageOverRange,
  employeeNameSimilarity,
  etpFractionToPct,
  frenchMonthNameToNumber,
  matchesClientName,
  matchesEmployeeName,
  normalizeNameForMatch,
  sumMetricRows,
  sumNullable,
  sumOfMonths,
} from './timeEstimationMath';

describe('normalizeNameForMatch', () => {
  it('lowercases and strips accents', () => {
    expect(normalizeNameForMatch('Cléa Boulland')).toBe('clea boulland');
  });

  it('matches an all-caps unaccented import string against an accented DB name', () => {
    expect(normalizeNameForMatch('CLEA BOULLAND')).toBe(normalizeNameForMatch('Cléa Boulland'));
  });

  it('collapses punctuation and extra whitespace', () => {
    expect(normalizeNameForMatch('  Aubert   de-Vincelles ')).toBe('aubert de vincelles');
  });
});

describe('matchesEmployeeName', () => {
  it('matches a multi-word last name without splitting the raw string', () => {
    expect(matchesEmployeeName('ALICE AUBERT DE VINCELLES', 'Alice', 'Aubert de Vincelles')).toBe(true);
  });

  it('does not match a different person', () => {
    expect(matchesEmployeeName('ANTOINE PANICUCCI', 'Alice', 'Aubert de Vincelles')).toBe(false);
  });
});

describe('matchesClientName', () => {
  it('matches case/accent-insensitively', () => {
    expect(matchesClientName('LACTALIS', 'Lactalis')).toBe(true);
  });

  it('does not fuzzy-match an abbreviation', () => {
    expect(matchesClientName('EUROPEAN PAYMENTS INITIATIVE', 'EPI')).toBe(false);
  });
});

describe('employeeNameSimilarity', () => {
  it('returns 1 for an exact match (modulo accents/case)', () => {
    expect(employeeNameSimilarity('CLEA BOULLAND', 'Cléa', 'Boulland')).toBe(1);
  });

  it('scores a close typo higher than an unrelated name', () => {
    const typo = employeeNameSimilarity('Cléa Boullant', 'Cléa', 'Boulland');
    const unrelated = employeeNameSimilarity('Antoine Panicucci', 'Cléa', 'Boulland');
    expect(typo).toBeGreaterThan(unrelated);
  });

  it('returns a value in [0, 1]', () => {
    const score = employeeNameSimilarity('Someone Else', 'Cléa', 'Boulland');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('frenchMonthNameToNumber', () => {
  it('resolves accented month names', () => {
    expect(frenchMonthNameToNumber('août')).toBe(8);
    expect(frenchMonthNameToNumber('décembre')).toBe(12);
    expect(frenchMonthNameToNumber('février')).toBe(2);
  });

  it('resolves unaccented/mixed-case month names', () => {
    expect(frenchMonthNameToNumber('Aout')).toBe(8);
    expect(frenchMonthNameToNumber('JUILLET')).toBe(7);
  });

  it('returns null for an unrecognized month', () => {
    expect(frenchMonthNameToNumber('smarch')).toBeNull();
  });
});

describe('etpFractionToPct', () => {
  it('scales a fraction to the 0-150 percent convention', () => {
    expect(etpFractionToPct(0.117994100294985)).toBeCloseTo(11.7994100294985);
  });
});

describe('sumOfMonths', () => {
  it('sums a range of monthly values', () => {
    expect(sumOfMonths([10, 20, 30])).toBe(60);
  });

  it('treats an absent month as 0', () => {
    expect(sumOfMonths([10, null, 20, undefined])).toBe(30);
  });

  it('returns 0 for an empty range', () => {
    expect(sumOfMonths([])).toBe(0);
  });
});

describe('averageOverRange', () => {
  it('averages over the full range length when every month has a value', () => {
    expect(averageOverRange([10, 20, 30])).toBeCloseTo(20);
  });

  it('counts an absent month as 0 in the denominator, not excluded from it', () => {
    // 3 months, only one has data (30) — average is 30/3, not 30/1.
    expect(averageOverRange([30, null, undefined])).toBeCloseTo(10);
  });

  it('returns 0 for an empty range rather than dividing by zero', () => {
    expect(averageOverRange([])).toBe(0);
  });

  it('% total actual N over a full 12-month year matches a simple average', () => {
    const months = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
    expect(averageOverRange(months)).toBeCloseTo(10);
  });
});

describe('sumNullable', () => {
  it('sums present values, ignoring null/undefined', () => {
    expect(sumNullable([1, null, 2, undefined, 3])).toBe(6);
  });

  it('returns null when every value is absent', () => {
    expect(sumNullable([null, undefined, null])).toBeNull();
  });

  it('returns 0 rather than null when at least one present value is 0', () => {
    expect(sumNullable([0, null])).toBe(0);
  });
});

describe('sumMetricRows', () => {
  it('sums matching keys across rows, unioning the key set', () => {
    const result = sumMetricRows([
      { vendu: 10, janvier: 5 },
      { vendu: 20, fevrier: 8 },
    ]);
    expect(result).toEqual({ vendu: 30, janvier: 5, fevrier: 8 });
  });

  it('leaves a key null when nobody in the group has it', () => {
    const result = sumMetricRows([{ vendu: null }, { vendu: null }]);
    expect(result.vendu).toBeNull();
  });
});
