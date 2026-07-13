import type { Department } from '../types/domain';

// Kept distinct from the green/amber/red hues used by etpStatus, so a
// department color never reads as an ETP-health signal.
const PALETTE = [
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#6366f1', // indigo
  '#d946ef', // fuchsia
  '#0ea5e9', // sky
  '#a855f7', // purple
  '#64748b', // slate
];

// Colors are assigned by creation order (departments is fetched sorted by
// created_at) rather than stored, so the mapping stays in sync everywhere
// (grid, chart, legend) without a schema column to keep consistent.
export function departmentColorMap(departments: Department[]): Map<string, string> {
  const map = new Map<string, string>();
  departments.forEach((d, i) => map.set(d.name, PALETTE[i % PALETTE.length]));
  return map;
}
