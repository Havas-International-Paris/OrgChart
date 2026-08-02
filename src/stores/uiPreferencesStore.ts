import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type GridDensity = 'compact' | 'comfortable';
export type ChartCardDensity = 'compact' | 'detailed';

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
      splitFraction: 0.5,
      setSplitFraction: (fraction) => set({ splitFraction: fraction }),
      chatWidthFraction: 0.3,
      setChatWidthFraction: (fraction) => set({ chatWidthFraction: fraction }),
      chatProviderId: null,
      setChatProviderId: (id) => set({ chatProviderId: id }),
    }),
    { name: 'orgchart-ui-prefs' },
  ),
);
