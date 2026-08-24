import type { RemunerationModel } from '../types/domain';

export type ActualPresencePeriod = 'n1' | 'n' | 'n1plus';

export interface TimeEstimationFilters {
  clientMissionIds: Set<string>;
  employeeIds: Set<string>;
  remunerationModels: Set<string>; // RemunerationModel values, kept as string to match FilterDropdown's Set<string> contract
  actualPresence: Set<string>; // ActualPresencePeriod values, same reasoning
}

export function emptyTimeEstimationFilters(): TimeEstimationFilters {
  return { clientMissionIds: new Set(), employeeIds: new Set(), remunerationModels: new Set(), actualPresence: new Set() };
}

export function hasActiveTimeEstimationFilters(f: TimeEstimationFilters): boolean {
  return f.clientMissionIds.size > 0 || f.employeeIds.size > 0 || f.remunerationModels.size > 0 || f.actualPresence.size > 0;
}

// Only the LineItem fields this module actually reads — kept structural
// (not imported from TimeEstimationGrid.tsx) to avoid a circular import;
// LineItem satisfies this shape automatically.
export interface FilterableLineItem {
  clientMissionId: string;
  employeeId: string;
  remunerationModel: RemunerationModel | null;
  n1Total: number | null;
  actualByMonth: (number | null)[];
  venduNextYear: number | null;
  prevuNextYear: number | null;
}

// A value counts as "present" unless it's null or an exact 0 — a small
// nonzero value (e.g. 0.4) still counts, matching TimeEstimationGrid.tsx's
// fmt()/roundedInputValue() display convention (only an exact 0 reads as
// blank there too; anything else nonzero is shown, down to 1 decimal for
// sub-1% values). Deliberately NOT Math.round(v) !== 0 — a rounded-to-zero
// check made the filter and the display disagree (a row could pass the
// filter as "present" while every cell it drove showed blank).
function isPresent(v: number | null): boolean {
  return v != null && v !== 0;
}

// Presence-of-actual-time per period, feeding the single multi-select's OR
// logic. N+1 has no true "actual" (future year, nothing imported yet) — per
// an explicit product decision, it's reinterpreted here as "the N+1
// forecast (vendu/prévu) has been filled in," not a real actual-time check.
function hasActualForPeriod(li: FilterableLineItem, period: string): boolean {
  switch (period as ActualPresencePeriod) {
    case 'n1':
      return isPresent(li.n1Total);
    case 'n':
      return li.actualByMonth.some(isPresent);
    case 'n1plus':
      return isPresent(li.venduNextYear) || isPresent(li.prevuNextYear);
    default:
      return false;
  }
}

export function matchesTimeEstimationFilters(li: FilterableLineItem, f: TimeEstimationFilters): boolean {
  if (f.clientMissionIds.size > 0 && !f.clientMissionIds.has(li.clientMissionId)) return false;
  if (f.employeeIds.size > 0 && !f.employeeIds.has(li.employeeId)) return false;
  // Scoped to the CURRENT-year model only (li.remunerationModel), not
  // remunerationModelNextYear. Justification: N+1 has its own independent
  // remunerationModelNextYear flag (0027) that can legitimately differ from
  // N's — a single filter bucket covering both would be ambiguous for a row
  // whose N and N+1 models differ (which bucket does it belong to?). This
  // also matches the R/C column shown next to Total N-1, which is likewise
  // current-year-only.
  if (f.remunerationModels.size > 0 && (!li.remunerationModel || !f.remunerationModels.has(li.remunerationModel))) return false;
  if (f.actualPresence.size > 0 && ![...f.actualPresence].some((p) => hasActualForPeriod(li, p))) return false;
  return true;
}
