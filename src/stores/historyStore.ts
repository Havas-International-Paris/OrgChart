import { create } from 'zustand';
import type { Command } from '../lib/history/types';
import { useToastStore } from './toastStore';

const MAX_HISTORY = 100;

// Deliberately separate from selectionStore.ts's chart-relative fields even
// though it's reset at the exact same moments (org-chart switch, see
// AppShell.tsx's switchOrgChart): history is its own concern and this keeps
// the two stores decoupled (neither imports the other). Like selectionStore
// and unlike uiPreferencesStore, this is in-memory only — no persist — since
// undo history must not survive a reload or leak across org charts.

// Not store state: flipped around every undo()/redo() replay (and around a
// compound action's own forward execution, see withSuppressedRecording) so
// that a command's undo/redo body can freely call the same hook-returned
// mutators the UI calls without those calls re-pushing themselves onto the
// stack. This is module-level rather than store state because it must be
// checked synchronously inside push() without going through a re-render.
let isReplaying = false;

export function isHistoryReplaying(): boolean {
  return isReplaying;
}

export async function withSuppressedRecording<T>(fn: () => Promise<T>): Promise<T> {
  const wasReplaying = isReplaying;
  isReplaying = true;
  try {
    return await fn();
  } finally {
    isReplaying = wasReplaying;
  }
}

interface HistoryState {
  undoStack: Command[];
  redoStack: Command[];
  // True while an undo()/redo() call is in flight, so the keyboard shortcut
  // and toast button can no-op instead of overlapping two replays on a fast
  // repeat keypress.
  isBusy: boolean;
  push: (command: Command) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  reset: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  undoStack: [],
  redoStack: [],
  isBusy: false,

  push: (command) => {
    // A compound action's own forward execution suppresses its sub-steps'
    // recording the same way a replay does (see quickAddManager etc.) — both
    // cases mean "don't record, something else already owns the recording."
    if (isReplaying) return;
    set((state) => {
      const undoStack = [...state.undoStack, command];
      // Oldest entries are simply forgotten once the cap is exceeded — there
      // is nothing to persist or warn about; 100 actions is deep enough that
      // losing action #101-ago is not surprising.
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      return { undoStack, redoStack: [] };
    });
    useToastStore.getState().show({
      message: command.label,
      actionLabel: 'Annuler',
      onAction: () => {
        useHistoryStore.getState().undo();
      },
    });
  },

  undo: async () => {
    const { undoStack, isBusy } = get();
    if (isBusy || undoStack.length === 0) return;
    const command = undoStack[undoStack.length - 1];
    set({ isBusy: true });
    try {
      await withSuppressedRecording(() => command.undo());
      set((state) => ({
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, command],
      }));
    } finally {
      set({ isBusy: false });
    }
  },

  redo: async () => {
    const { redoStack, isBusy } = get();
    if (isBusy || redoStack.length === 0) return;
    const command = redoStack[redoStack.length - 1];
    set({ isBusy: true });
    try {
      await withSuppressedRecording(() => command.redo());
      set((state) => ({
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, command],
      }));
    } finally {
      set({ isBusy: false });
    }
  },

  reset: () => set({ undoStack: [], redoStack: [], isBusy: false }),
  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,
}));
