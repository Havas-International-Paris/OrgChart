import { describe, expect, it } from 'vitest';
import { roundedPolylinePath, routeAroundObstacles, type Rect } from './edgeRouting';

describe('routeAroundObstacles', () => {
  it('returns null when nothing sits between source and target', () => {
    const result = routeAroundObstacles({ x: 0, y: 0 }, { x: 100, y: 100 }, []);
    expect(result).toBeNull();
  });

  it('returns null when obstacles exist but none lie on the direct line', () => {
    const obstacles: Rect[] = [{ x: 500, y: 500, width: 220, height: 190 }];
    const result = routeAroundObstacles({ x: 0, y: 0 }, { x: 100, y: 0 }, obstacles);
    expect(result).toBeNull();
  });

  it('routes around a single obstacle directly on the straight line', () => {
    // Source and target are vertically aligned with an obstacle sitting
    // exactly between them — the direct line runs straight through it.
    const obstacle: Rect = { x: -30, y: 80, width: 60, height: 40 };
    const source = { x: 0, y: 0 };
    const target = { x: 0, y: 200 };
    const result = routeAroundObstacles(source, target, [obstacle]);

    expect(result).not.toBeNull();
    const bends = result!;
    expect(bends.length).toBeGreaterThan(0);

    // The full path (source -> bends -> target) must never cross the
    // obstacle's inflated interior.
    const full = [source, ...bends, target];
    for (let i = 0; i < full.length - 1; i += 1) {
      const p1 = full[i];
      const p2 = full[i + 1];
      const crossesX = Math.min(p1.x, p2.x) < obstacle.x + obstacle.width && Math.max(p1.x, p2.x) > obstacle.x;
      const crossesY = Math.min(p1.y, p2.y) < obstacle.y + obstacle.height && Math.max(p1.y, p2.y) > obstacle.y;
      // A segment can only violate the obstacle if it overlaps it on BOTH
      // axes and isn't a hairline graze — the router keeps at least the
      // 16px margin clear, so use the raw obstacle bounds as the tripwire.
      expect(crossesX && crossesY).toBe(false);
    }
  });

  it('ignores obstacles far outside the source/target bounding box', () => {
    const farObstacle: Rect = { x: 10_000, y: 10_000, width: 220, height: 190 };
    const result = routeAroundObstacles({ x: 0, y: 0 }, { x: 100, y: 0 }, [farObstacle]);
    expect(result).toBeNull();
  });

  it('every returned bend point is axis-aligned with its neighbours', () => {
    const obstacle: Rect = { x: -30, y: 80, width: 60, height: 40 };
    const source = { x: 0, y: 0 };
    const target = { x: 0, y: 200 };
    const result = routeAroundObstacles(source, target, [obstacle])!;
    const full = [source, ...result, target];
    for (let i = 0; i < full.length - 1; i += 1) {
      const p1 = full[i];
      const p2 = full[i + 1];
      expect(p1.x === p2.x || p1.y === p2.y).toBe(true);
    }
  });
});

describe('roundedPolylinePath', () => {
  it('draws a plain line for two points', () => {
    const path = roundedPolylinePath([{ x: 0, y: 0 }, { x: 10, y: 0 }], 8);
    expect(path).toBe('M 0 0 L 10 0');
  });

  it('starts and ends exactly at the given endpoints regardless of bends', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 100 },
      { x: 120, y: 100 },
    ];
    const path = roundedPolylinePath(points, 8);
    expect(path.startsWith('M 0 0')).toBe(true);
    expect(path.endsWith('L 120 100')).toBe(true);
  });

  it('clamps the corner radius so it never overshoots a short segment', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 100 },
    ];
    // Radius (8) is larger than half the 4px first segment — should not throw
    // and should still produce a valid path string.
    const path = roundedPolylinePath(points, 8);
    expect(path).toContain('M 0 0');
    expect(path).toContain('Q 4 0');
  });
});
