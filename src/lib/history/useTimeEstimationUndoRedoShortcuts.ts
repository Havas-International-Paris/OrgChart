import { useTimeEstimationHistoryStore } from '../../stores/timeEstimationHistoryStore';
import { useHistoryKeyboardShortcut } from './useHistoryKeyboardShortcut';

// Time Estimation screen's Cmd/Ctrl+Z, targeting its own independent
// history store — no `enabled` flag needed, unlike useUndoRedoShortcuts.ts,
// since TimeEstimationScreen only ever mounts while its own screen is
// showing (AppShell.tsx's early return), so the listener naturally
// attaches/detaches with the screen itself.
export function useTimeEstimationUndoRedoShortcuts() {
  useHistoryKeyboardShortcut(useTimeEstimationHistoryStore, true);
}
