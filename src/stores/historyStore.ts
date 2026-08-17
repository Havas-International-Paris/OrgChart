import { createHistoryStore } from './createHistoryStore';
import type { Command } from '../lib/history/types';

// The org-chart/grid screen's undo/redo history — see createHistoryStore.ts
// for the shared push/undo/redo/reset implementation. Deliberately separate
// from selectionStore.ts's chart-relative fields even though it's reset at
// the exact same moments (org-chart switch, see AppShell.tsx's
// switchOrgChart): history is its own concern and this keeps the two stores
// decoupled (neither imports the other). Like selectionStore and unlike
// uiPreferencesStore, this is in-memory only — no persist — since undo
// history must not survive a reload or leak across org charts.
//
// The Time Estimation screen has its own fully independent instance, see
// timeEstimationHistoryStore.ts — the two never share state or an
// isReplaying flag.
const { useStore, isReplaying, withSuppressedRecording } = createHistoryStore<Command>();

export const useHistoryStore = useStore;

export function isHistoryReplaying(): boolean {
  return isReplaying();
}

export { withSuppressedRecording };
