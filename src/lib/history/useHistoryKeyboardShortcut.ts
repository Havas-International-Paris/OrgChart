import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { HistoryStoreHook } from '../../stores/createHistoryStore';
import { useToastStore } from '../../stores/toastStore';
import type { HistoryCommand } from './types';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

// Wires a global Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Shift+Z (redo) listener
// against any createHistoryStore.ts-shaped store — shared by
// useUndoRedoShortcuts.ts (org-chart/grid) and
// useTimeEstimationUndoRedoShortcuts.ts (Time Estimation), each targeting
// its own independent store. `enabled` lets a caller mounted regardless of
// which screen is showing (see AppShell.tsx, which calls its hook before
// the Time Estimation early return) suppress the listener while its own
// screen isn't the active one, so the two screens' shortcuts can never
// cross-fire.
export function useHistoryKeyboardShortcut<C extends HistoryCommand>(useStore: HistoryStoreHook<C>, enabled: boolean) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== 'z') return;
      if (isEditableTarget(e.target)) return;

      e.preventDefault();
      const state = useStore.getState();
      if (e.shiftKey) {
        const command = state.redoStack.at(-1);
        state.redo().then(() => {
          if (command) useToastStore.getState().show({ message: t('undoRedo.redoneToast', { label: command.label }) });
        });
      } else {
        const command = state.undoStack.at(-1);
        state.undo().then(() => {
          if (command) useToastStore.getState().show({ message: t('undoRedo.undoneToast', { label: command.label }) });
        });
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [useStore, enabled, t]);
}
