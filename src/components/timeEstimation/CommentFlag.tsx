import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '../shared/Tooltip';

interface CommentFlagProps {
  comment: string | null;
  onSave: (text: string) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
}

// Small flag icon rendered as a sibling of RowOriginMarker (TimeEstimationGrid.tsx,
// both call sites) — light grey with no comment, red once one exists. Own
// file (unlike RowOriginMarker, kept inline) because of the popover: fixed-
// position calc + viewport clamping (ContextMenu.tsx's pattern, not
// FilterDropdown.tsx's — the grid's row container is overflow-auto with no
// ancestor transform, so an `absolute` popover risks clipping), capture-
// phase outside-click, Escape, and a small textarea form are more machinery
// than a plain span/button pair.
export function CommentFlag({ comment, onSave, onDelete }: CommentFlagProps) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(comment ?? '');
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);

  const hasComment = comment != null;

  function openPopover() {
    setDraft(comment ?? '');
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ x: rect.left, y: rect.bottom + 4 });
    setOpen(true);
  }

  // Clamps against the viewport once the popover has a real size to
  // measure — same two-step approach as ContextMenu.tsx (start at the raw
  // anchor point, correct after mount).
  useLayoutEffect(() => {
    if (!open) return;
    const popover = popoverRef.current;
    if (!popover) return;
    const rect = popover.getBoundingClientRect();
    setPos((p) => ({
      x: Math.max(8, Math.min(p.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(p.y, window.innerHeight - rect.height - 8)),
    }));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    // Capture phase — see ContextMenu.tsx's own comment: several sibling
    // grid controls call stopPropagation() in bubble phase, which would
    // otherwise block a bubble-phase document listener from ever firing.
    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  async function handleSave() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onSave(trimmed);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await onDelete();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Tooltip content={hasComment ? comment! : t('timeEstimation.grid.commentAddTooltip')} enabled={!open}>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (open) setOpen(false);
          else openPopover();
        }}
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${
          hasComment ? 'text-red-500 hover:bg-red-50' : 'text-slate-300 hover:bg-slate-100 hover:text-slate-400'
        }`}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-3 w-3">
          <path d="M5 3a1 1 0 0 0-1 1v17a1 1 0 1 0 2 0v-6h11.5a1 1 0 0 0 .8-1.6L15.25 9l3.05-4.4A1 1 0 0 0 17.5 3H5Z" />
        </svg>
      </button>
      </Tooltip>
      {open && (
        <div
          ref={popoverRef}
          style={{ position: 'fixed', left: pos.x, top: pos.y }}
          className="z-30 w-64 rounded-md border border-slate-200 bg-white p-2 shadow-lg"
        >
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('timeEstimation.commentPopover.placeholder')}
            rows={3}
            className="w-full resize-none rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            {hasComment && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="mr-auto rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {t('timeEstimation.commentPopover.delete')}
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
              {t('timeEstimation.commentPopover.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || draft.trim().length === 0}
              className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {t('timeEstimation.commentPopover.save')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
