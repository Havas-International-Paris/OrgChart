import { describe, expect, it } from 'vitest';
import { clampRangeEdge } from './rangeSliderMath';

const bounds = { min: 0, max: 150 };

describe('clampRangeEdge', () => {
  it('moves the min edge freely while it stays below the max edge', () => {
    expect(clampRangeEdge('min', 40, { min: 0, max: 100 }, bounds)).toEqual({ min: 40, max: 100 });
  });

  it('moves the max edge freely while it stays above the min edge', () => {
    expect(clampRangeEdge('max', 80, { min: 20, max: 100 }, bounds)).toEqual({ min: 20, max: 80 });
  });

  it('stops the min edge at the current max rather than crossing it', () => {
    expect(clampRangeEdge('min', 90, { min: 20, max: 60 }, bounds)).toEqual({ min: 60, max: 60 });
  });

  it('stops the max edge at the current min rather than crossing it', () => {
    expect(clampRangeEdge('max', 10, { min: 60, max: 100 }, bounds)).toEqual({ min: 60, max: 60 });
  });

  it('clamps a min value below the lower bound', () => {
    expect(clampRangeEdge('min', -20, { min: 0, max: 100 }, bounds)).toEqual({ min: 0, max: 100 });
  });

  it('clamps a max value above the upper bound', () => {
    expect(clampRangeEdge('max', 999, { min: 0, max: 100 }, bounds)).toEqual({ min: 0, max: 150 });
  });

  it('handles a degenerate current range (min === max) without inverting', () => {
    expect(clampRangeEdge('min', 80, { min: 50, max: 50 }, bounds)).toEqual({ min: 50, max: 50 });
    expect(clampRangeEdge('max', 20, { min: 50, max: 50 }, bounds)).toEqual({ min: 50, max: 50 });
  });
});
