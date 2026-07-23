import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type GridDensity = 'compact' | 'comfortable';

interface UiPreferencesState {
  gridDensity: GridDensity;
  setGridDensity: (density: GridDensity) => void;
  // Left panel's width as a fraction of the grid/chart split — see AppShell.tsx.
  splitFraction: number;
  setSplitFraction: (fraction: number) => void;
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
      splitFraction: 0.5,
      setSplitFraction: (fraction) => set({ splitFraction: fraction }),
    }),
    { name: 'orgchart-ui-prefs' },
  ),
);
