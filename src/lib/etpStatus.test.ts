import { describe, expect, it } from 'vitest';
import { etpStatus } from './etpStatus';

// The thresholds are asymmetric (green 90-105, so 15 points of headroom above
// target but only 10 below) and every band boundary is inclusive on one side
// only — exactly the kind of thing a refactor silently shifts by one.
describe('etpStatus', () => {
  it('is green across the whole 90-105 band, boundaries included', () => {
    expect(etpStatus(90)).toBe('green');
    expect(etpStatus(100)).toBe('green');
    expect(etpStatus(105)).toBe('green');
  });

  it('is amber just outside green on both sides', () => {
    expect(etpStatus(89.9)).toBe('amber');
    expect(etpStatus(105.1)).toBe('amber');
  });

  it('is amber across both amber bands, outer boundaries included', () => {
    expect(etpStatus(80)).toBe('amber');
    expect(etpStatus(85)).toBe('amber');
    expect(etpStatus(115)).toBe('amber');
  });

  it('is red beyond either amber band', () => {
    expect(etpStatus(79.9)).toBe('red');
    expect(etpStatus(115.1)).toBe('red');
  });

  it('is red for an unassigned employee and for absurd overload', () => {
    expect(etpStatus(0)).toBe('red');
    expect(etpStatus(500)).toBe('red');
  });

  // Not reachable through the UI (%ETP inputs are non-negative), but the
  // function has no guard, so pin the behaviour rather than leave it undefined.
  it('treats a negative total as red', () => {
    expect(etpStatus(-10)).toBe('red');
  });
});
