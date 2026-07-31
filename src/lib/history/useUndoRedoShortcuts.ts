import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useHistoryStore } from '../../stores/historyStore';
import { useToastStore } from '../../stores/toastStore';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

// Wires a global Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Shift+Z (redo) listener. No
// UI of its own — mounted once from AppShell.tsx.
export function useUndoRedoShortcuts() {
  const { t } = useTranslation();
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== 'z') return;
      if (isEditableTarget(e.target)) return;

      e.preventDefault();
      if (e.shiftKey) {
        const command = useHistoryStore.getState().redoStack.at(-1);
        redo().then(() => {
          if (command) useToastStore.getState().show({ message: t('undoRedo.redoneToast', { label: command.label }) });
        });
      } else {
        const command = useHistoryStore.getState().undoStack.at(-1);
        undo().then(() => {
          if (command) useToastStore.getState().show({ message: t('undoRedo.undoneToast', { label: command.label }) });
        });
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, t]);
}
