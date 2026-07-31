export interface Range {
  min: number;
  max: number;
}

export type RangeEdge = 'min' | 'max';

// Clamps one edge of a dual-handle range slider after the user drags it,
// given which edge moved. First clamps the dragged value into `bounds`, then
// enforces min <= max by stopping the dragged edge AT its sibling rather
// than pushing the sibling along with it — the same "a thumb can't cross
// its sibling, it just stops there" behavior every standard dual-range
// widget has. Needs to know which edge moved (not inferable from the
// resulting {min,max} alone: e.g. current {50,50}, dragging min to 80 and
// dragging max to 20 both produce an inverted pair that looks identical
// without knowing which handle the user actually grabbed).
export function clampRangeEdge(edge: RangeEdge, value: number, current: Range, bounds: Range): Range {
  const clamped = Math.min(Math.max(value, bounds.min), bounds.max);
  if (edge === 'min') {
    return { min: Math.min(clamped, current.max), max: current.max };
  }
  return { min: current.min, max: Math.max(clamped, current.min) };
}
