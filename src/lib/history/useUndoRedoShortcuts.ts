import { useHistoryStore } from '../../stores/historyStore';
import { useHistoryKeyboardShortcut } from './useHistoryKeyboardShortcut';

// Org-chart/grid screen's Cmd/Ctrl+Z — mounted once from AppShell.tsx,
// `enabled` false while the Time Estimation screen is showing so the two
// screens' shortcuts can never cross-fire (AppShell.tsx calls this hook
// unconditionally, before its Time Estimation early return, so it can't
// simply stop being called — see useTimeEstimationUndoRedoShortcuts.ts for
// the Time Estimation side, which has no such constraint).
export function useUndoRedoShortcuts(enabled: boolean) {
  useHistoryKeyboardShortcut(useHistoryStore, enabled);
}
