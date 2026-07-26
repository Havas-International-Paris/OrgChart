import { describe, expect, it } from 'vitest';
import { baseSizePct } from './photoFrameMath';

// The invariant that makes one (zoom, panX, panY) triple render identically at
// 28px, 36px and 220px: the returned percentages depend only on the source
// image's aspect ratio, and the *shorter* side always lands exactly on 100%
// (cover fit — the frame is fully covered, nothing letterboxed).
describe('baseSizePct', () => {
  it('returns 100/100 for a square image', () => {
    expect(baseSizePct(500, 500)).toEqual({ widthPct: 100, heightPct: 100 });
  });

  it('overflows horizontally for a landscape image', () => {
    expect(baseSizePct(200, 100)).toEqual({ widthPct: 200, heightPct: 100 });
  });

  it('overflows vertically for a portrait image', () => {
    expect(baseSizePct(100, 200)).toEqual({ widthPct: 100, heightPct: 200 });
  });

  it('depends only on the aspect ratio, not the pixel dimensions', () => {
    expect(baseSizePct(1600, 900)).toEqual(baseSizePct(320, 180));
  });

  it('always covers the frame: the smaller side is exactly 100%', () => {
    for (const [w, h] of [
      [3, 4],
      [4, 3],
      [1, 1],
      [16, 9],
      [9, 16],
      [1000, 7],
    ]) {
      const { widthPct, heightPct } = baseSizePct(w, h);
      expect(Math.min(widthPct, heightPct)).toBeCloseTo(100, 10);
      expect(Math.max(widthPct, heightPct)).toBeGreaterThanOrEqual(100);
    }
  });
});
