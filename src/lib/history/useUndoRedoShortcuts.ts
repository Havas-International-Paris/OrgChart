import { useEffect } from 'react';
import { useHistoryStore } from '../../stores/historyStore';
import { useToastStore } from '../../stores/toastStore';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return true;
  // AG Grid's inline/popup cell editors render a plain <input> too, but also
  // mark the editing cell/popup itself — belt-and-suspenders in case a
  // custom cell editor ever doesn't use a plain <input>. There's no built-in
  // grid-level Ctrl+Z to conflict with (no AG Grid component here sets
  // undoRedoCellEditing), but a cell actively being edited should still keep
  // the browser's/AG Grid's own native undo for that field.
  if (target.closest('.ag-cell-inline-editing, .ag-popup-editor')) return true;
  return false;
}

// Wires a global Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Shift+Z (redo) listener. No
// UI of its own — same "hook wires a document-level listener, renders
// nothing" shape as useRowStabilizer.ts's mousedown effect. Mounted once
// from AppShell.tsx.
export function useUndoRedoShortcuts() {
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
          if (command) useToastStore.getState().show({ message: `Rétabli : ${command.label}` });
        });
      } else {
        const command = useHistoryStore.getState().undoStack.at(-1);
        undo().then(() => {
          if (command) useToastStore.getState().show({ message: `Annulé : ${command.label}` });
        });
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);
}
