import { useHistoryStore } from '../../stores/historyStore';

function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7z" />
    </svg>
  );
}

// Persistent undo/redo control, distinct from the transient toast (which
// still fires alongside these for a "what just happened" message) — this is
// the primary, always-visible way to see whether there's anything to undo/
// redo and to trigger it, rendered once each beside the grid's "+ Ajouter"
// and beside the chart's zoom controls.
export function UndoRedoButtons({ className }: { className?: string }) {
  const canUndo = useHistoryStore((s) => s.undoStack.length > 0);
  const canRedo = useHistoryStore((s) => s.redoStack.length > 0);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  return (
    <div
      className={`flex items-stretch overflow-hidden rounded border border-slate-300 bg-white ${className ?? ''}`}
    >
      <button
        onClick={() => undo()}
        disabled={!canUndo}
        title="Annuler"
        className="flex items-center justify-center px-2 py-1 text-slate-700 enabled:hover:bg-slate-100 disabled:text-slate-300"
      >
        <UndoIcon />
      </button>
      <div className="w-px bg-slate-300" />
      <button
        onClick={() => redo()}
        disabled={!canRedo}
        title="Rétablir"
        className="flex items-center justify-center px-2 py-1 text-slate-700 enabled:hover:bg-slate-100 disabled:text-slate-300"
      >
        <RedoIcon />
      </button>
    </div>
  );
}
