import { useSelectionStore } from '../stores/selectionStore';

const ETP_BOUNDS = { min: 0, max: 150 };
const isRangeActive = (range: { min: number; max: number }) => range.min !== ETP_BOUNDS.min || range.max !== ETP_BOUNDS.max;

// Count of FILTER DIMENSIONS currently active (0-6) — not total selected
// items across every dimension. Selecting every single Business Unit should
// still read as "1 filter active," not jump to double digits; this mirrors
// what "Réinitialiser" actually resets (whole dimensions at once). Shared by
// FiltersToggle.tsx's header badge and FiltersBar.tsx's own "show
// Réinitialiser or not" check, so the two can never disagree about what
// counts as active.
export function useActiveFilterCount(): number {
  const clientMissionFilterIds = useSelectionStore((s) => s.clientMissionFilterIds);
  const deptFilterNames = useSelectionStore((s) => s.deptFilterNames);
  const companyFilterNames = useSelectionStore((s) => s.companyFilterNames);
  const jobTitleFilterNames = useSelectionStore((s) => s.jobTitleFilterNames);
  const etpVenduRange = useSelectionStore((s) => s.etpVenduRange);
  const etpReelRange = useSelectionStore((s) => s.etpReelRange);

  return (
    (clientMissionFilterIds.size > 0 ? 1 : 0) +
    (deptFilterNames.size > 0 ? 1 : 0) +
    (companyFilterNames.size > 0 ? 1 : 0) +
    (jobTitleFilterNames.size > 0 ? 1 : 0) +
    (isRangeActive(etpVenduRange) ? 1 : 0) +
    (isRangeActive(etpReelRange) ? 1 : 0)
  );
}

// Which of the 6 dimensions are active, as i18n keys under "filters." —
// FiltersToggle.tsx turns these into translated labels for its badge's hover
// tooltip, so "which filter is on" doesn't require opening the bar to check.
// Same dimension shape as the count above, deliberately kept as a sibling
// hook rather than folded into it, since most callers only need the count.
export function useActiveFilterKeys(): string[] {
  const clientMissionFilterIds = useSelectionStore((s) => s.clientMissionFilterIds);
  const deptFilterNames = useSelectionStore((s) => s.deptFilterNames);
  const companyFilterNames = useSelectionStore((s) => s.companyFilterNames);
  const jobTitleFilterNames = useSelectionStore((s) => s.jobTitleFilterNames);
  const etpVenduRange = useSelectionStore((s) => s.etpVenduRange);
  const etpReelRange = useSelectionStore((s) => s.etpReelRange);

  const keys: string[] = [];
  if (deptFilterNames.size > 0) keys.push('businessUnit');
  if (companyFilterNames.size > 0) keys.push('company');
  if (jobTitleFilterNames.size > 0) keys.push('jobTitle');
  if (clientMissionFilterIds.size > 0) keys.push('clientMission');
  if (isRangeActive(etpVenduRange)) keys.push('timeSold');
  if (isRangeActive(etpReelRange)) keys.push('timeActual');
  return keys;
}
