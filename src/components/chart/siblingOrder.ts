// Shared between layoutEngine.ts (reading sibling_order to reposition
// nodes) and OrgChartView.tsx's drag handler (writing it) so both agree on
// identical grouping/gap semantics.

// Sentinel group key for employees with no primary manager (roots )— mirrors
// useVisibleGraph.ts's own roots detection (hasPrimaryManager check), just
// expressed as a map key here instead of a filter.
export const ROOT_GROUP_KEY = '__root__';

// Initial spacing between backfilled siblings' sibling_order values, and
// the amount added/subtracted when dropping at either end of an
// already-backfilled group. A drop between two neighbors instead uses
// their midpoint — see useEmployees.ts's updateSiblingOrders call sites.
export const SIBLING_ORDER_GAP = 1000;
