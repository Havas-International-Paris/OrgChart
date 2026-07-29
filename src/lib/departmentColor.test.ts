import { describe, expect, it } from 'vitest';
import { NEUTRAL_DEPARTMENT_COLOR, departmentColorMap, withAlpha } from './departmentColor';
import type { Department } from '../types/domain';

function dept(name: string, color: string | null = null): Department {
  return { id: `d-${name}`, name, color, created_at: '2026-01-01T00:00:00Z' };
}

describe('departmentColorMap', () => {
  it('keys by department name, not id', () => {
    const map = departmentColorMap([dept('Media'), dept('Créa')]);
    expect(map.has('Media')).toBe(true);
    expect(map.has('d-Media')).toBe(false);
  });

  it('gives distinct colors to the first nine departments', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const map = departmentColorMap(names.map((n) => dept(n)));
    expect(new Set(map.values()).size).toBe(9);
  });

  it('wraps around the palette past nine departments', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const map = departmentColorMap(names.map((n) => dept(n)));
    expect(map.get('j')).toBe(map.get('a'));
  });

  // Colors come from array position rather than a stored column, so the
  // whole scheme rests on the input arriving in a stable order (departments
  // is fetched sorted by created_at). Reordering the input reassigns colors —
  // pinned here so the coupling is visible if that fetch ever changes.
  it('assigns strictly by position, so input order decides the colors', () => {
    const forward = departmentColorMap([dept('a'), dept('b')]);
    const reversed = departmentColorMap([dept('b'), dept('a')]);
    expect(forward.get('a')).toBe(reversed.get('b'));
    expect(forward.get('a')).not.toBe(reversed.get('a'));
  });

  it('never hands out the neutral no-department color', () => {
    const names = Array.from({ length: 30 }, (_, i) => `d${i}`);
    const map = departmentColorMap(names.map((n) => dept(n)));
    expect([...map.values()]).not.toContain(NEUTRAL_DEPARTMENT_COLOR);
  });

  it('returns an empty map for no departments', () => {
    expect(departmentColorMap([]).size).toBe(0);
  });

  it('an explicit stored color takes precedence over the palette color at that position', () => {
    // 'reference' at the same position (0), left uncolored, shows what 'a'
    // would otherwise have gotten from the palette.
    const withColor = departmentColorMap([dept('a', '#123456'), dept('b')]);
    const reference = departmentColorMap([dept('reference'), dept('b')]);
    expect(withColor.get('a')).toBe('#123456');
    expect(withColor.get('a')).not.toBe(reference.get('reference'));
  });

  it('departments without a stored color still get their palette color by position, alongside ones that do', () => {
    const map = departmentColorMap([dept('a', '#111111'), dept('b'), dept('c', '#333333')]);
    const reference = departmentColorMap([dept('x'), dept('reference'), dept('z')]);
    expect(map.get('a')).toBe('#111111');
    expect(map.get('b')).toBe(reference.get('reference'));
    expect(map.get('c')).toBe('#333333');
  });
});

describe('withAlpha', () => {
  it('appends a two-digit hex alpha channel', () => {
    expect(withAlpha('#3b82f6', 1)).toBe('#3b82f6ff');
    expect(withAlpha('#3b82f6', 0)).toBe('#3b82f600');
  });

  it('pads a single-digit channel to two digits', () => {
    // 0.02 * 255 ≈ 5 → "05", not "5", which would corrupt the hex string.
    expect(withAlpha('#3b82f6', 0.02)).toBe('#3b82f605');
  });

  it('clamps out-of-range alpha instead of producing invalid hex', () => {
    expect(withAlpha('#3b82f6', 5)).toBe('#3b82f6ff');
    expect(withAlpha('#3b82f6', -1)).toBe('#3b82f600');
  });

  it('always produces a 9-character #rrggbbaa string', () => {
    for (const a of [0, 0.01, 0.1, 0.5, 0.99, 1]) {
      expect(withAlpha('#3b82f6', a)).toHaveLength(9);
    }
  });
});
