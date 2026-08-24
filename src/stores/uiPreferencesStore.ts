import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type GridDensity = 'compact' | 'comfortable';
export type ChartCardDensity = 'compact' | 'detailed';
export type ChartColorBy = 'department' | 'company';

interface UiPreferencesState {
  gridDensity: GridDensity;
  setGridDensity: (density: GridDensity) => void;
  // Chart card display mode (backlog item 51) — 'detailed' (default) shows
  // everything EmployeeNode.tsx can render; 'compact' hides the ETP bars,
  // advertiser list and subordinate-count badge (still reachable via
  // EmployeeDetailPanel.tsx on click). Default 'detailed' so this never
  // changes existing behavior for someone who's never touched the toggle.
  chartCardDensity: ChartCardDensity;
  setChartCardDensity: (density: ChartCardDensity) => void;
  // Which dimension the chart's card borders/legend color by — the legend
  // widget itself hosts the toggle (DepartmentLegend.tsx), not the chart's
  // kebab menu. Default 'department' preserves existing behavior.
  chartColorBy: ChartColorBy;
  setChartColorBy: (colorBy: ChartColorBy) => void;
  // Left panel's width as a fraction of the grid/chart split — see AppShell.tsx.
  splitFraction: number;
  setSplitFraction: (fraction: number) => void;
  // AI chat panel's width as a fraction of the whole shell, same resizable-
  // divider pattern as splitFraction above. Not chatOpen itself — whether the
  // panel is showing is ephemeral (plain useState in AppShell, like
  // filtersOpen), only its width is worth remembering across sessions.
  chatWidthFraction: number;
  setChatWidthFraction: (fraction: number) => void;
  // The user's explicit pick from ChatPanel.tsx's model-picker dropdown
  // (added 2026-08-01) — null means "use the server's own default"
  // (LLM_PROVIDER env / auto-detect, see chatHandler.ts's
  // resolveProviderMeta()), never sent as an override until the user
  // actually picks something. Persisted per-browser like the rest of this
  // store, so a chosen provider survives a reload but never leaks to anyone
  // else — same rationale as gridDensity/splitFraction above.
  chatProviderId: string | null;
  setChatProviderId: (id: string | null) => void;
  // Time Estimation grid's label column (employee/client name) width in px —
  // the only column a user can resize; null means "use the default flexible
  // minmax(180px,1fr) width." See TimeEstimationGrid.tsx's
  // gridTemplateColumns construction.
  timeEstimationLabelColumnWidth: number | null;
  setTimeEstimationLabelColumnWidth: (width: number) => void;
  // Whether the 12 individual month columns (Jan-Dec of the current year N)
  // are hidden, leaving only the Avg past/Avg remaining summary columns —
  // see the "hide N months" toggle in TimeEstimationGrid.tsx. Persisted like
  // the width prefs above (not a plain useState like groupBy/collapsedGroups
  // in that file) because this is a durable "make the grid fit my screen"
  // layout choice, not per-session exploration state.
  timeEstimationMonthsHidden: boolean;
  setTimeEstimationMonthsHidden: (hidden: boolean) => void;
}

// Deliberately separate from selectionStore.ts: these are per-browser UI
// preferences (persisted to localStorage, never synced through Supabase —
// so one person's choice never affects anyone else), not chart-relative
// state that should reset when switching org charts.
export const useUiPreferencesStore = create<UiPreferencesState>()(
  persist(
    (set) => ({
      gridDensity: 'comfortable',
      setGridDensity: (density) => set({ gridDensity: density }),
      chartCardDensity: 'detailed',
      setChartCardDensity: (density) => set({ chartCardDensity: density }),
      chartColorBy: 'department',
      setChartColorBy: (colorBy) => set({ chartColorBy: colorBy }),
      splitFraction: 0.5,
      setSplitFraction: (fraction) => set({ splitFraction: fraction }),
      chatWidthFraction: 0.3,
      setChatWidthFraction: (fraction) => set({ chatWidthFraction: fraction }),
      chatProviderId: null,
      setChatProviderId: (id) => set({ chatProviderId: id }),
      timeEstimationLabelColumnWidth: null,
      setTimeEstimationLabelColumnWidth: (width) => set({ timeEstimationLabelColumnWidth: width }),
      timeEstimationMonthsHidden: false,
      setTimeEstimationMonthsHidden: (hidden) => set({ timeEstimationMonthsHidden: hidden }),
    }),
    { name: 'orgchart-ui-prefs' },
  ),
);
