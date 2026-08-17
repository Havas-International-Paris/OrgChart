import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { HistoryCommand } from '../lib/history/types';
import { useToastStore } from './toastStore';
import i18n from '../i18n/config';

const MAX_HISTORY = 100;

export interface HistoryState<C extends HistoryCommand> {
  undoStack: C[];
  redoStack: C[];
  // True while an undo()/redo() call is in flight, so the keyboard shortcut
  // and toast button can no-op instead of overlapping two replays on a fast
  // repeat keypress.
  isBusy: boolean;
  push: (command: C) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  reset: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export type HistoryStoreHook<C extends HistoryCommand> = UseBoundStore<StoreApi<HistoryState<C>>>;

export interface HistoryStoreBundle<C extends HistoryCommand> {
  useStore: HistoryStoreHook<C>;
  isReplaying: () => boolean;
  withSuppressedRecording: <T>(fn: () => Promise<T>) => Promise<T>;
}

// Factory so the org-chart/grid screen and the Time Estimation screen can
// each own a fully independent undo/redo stack — same push/undo/redo/reset
// shape (moved here unchanged from the original single historyStore.ts),
// but never sharing state. In particular `isReplaying` is a variable closed
// over by THIS call only, not a module-level global — flipped around every
// undo()/redo() replay (and around a compound action's own forward
// execution) so a command's undo/redo body can freely call the same
// hook-returned mutators the UI calls without those calls re-pushing
// themselves onto the stack, without one store's replay accidentally
// suppressing the OTHER store's recording.
export function createHistoryStore<C extends HistoryCommand>(): HistoryStoreBundle<C> {
  let isReplaying = false;

  async function withSuppressedRecording<T>(fn: () => Promise<T>): Promise<T> {
    const wasReplaying = isReplaying;
    isReplaying = true;
    try {
      return await fn();
    } finally {
      isReplaying = wasReplaying;
    }
  }

  const useStore = create<HistoryState<C>>((set, get) => ({
    undoStack: [],
    redoStack: [],
    isBusy: false,

    push: (command) => {
      // A compound action's own forward execution suppresses its sub-steps'
      // recording the same way a replay does (see quickAddManager etc.) —
      // both cases mean "don't record, something else already owns the
      // recording."
      if (isReplaying) return;
      set((state) => {
        const undoStack = [...state.undoStack, command];
        // Oldest entries are simply forgotten once the cap is exceeded —
        // there is nothing to persist or warn about; 100 actions is deep
        // enough that losing action #101-ago is not surprising.
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        return { undoStack, redoStack: [] };
      });
      useToastStore.getState().show({
        message: command.label,
        actionLabel: i18n.t('undoRedo.undo'),
        onAction: () => {
          useStore.getState().undo();
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

  return { useStore, isReplaying: () => isReplaying, withSuppressedRecording };
}
