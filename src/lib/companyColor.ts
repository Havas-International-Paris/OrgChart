import type { Company } from '../types/domain';

// Kept distinct from the green/amber/red hues used by etpStatus, so a
// company color never reads as an ETP-health signal.
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

// Colors are assigned by creation order (companies is fetched sorted by
// created_at) unless a company has an explicit stored `color` (set via the
// Companies grid's color picker), which always takes precedence.
export function companyColorMap(companies: Company[]): Map<string, string> {
  const map = new Map<string, string>();
  companies.forEach((c, i) => map.set(c.name, c.color ?? PALETTE[i % PALETTE.length]));
  return map;
}

// Neutral fallback for chart nodes with no company set — kept out of
// PALETTE so it's never assigned to an actual company.
export const NEUTRAL_COMPANY_COLOR = '#94a3b8'; // slate-400
