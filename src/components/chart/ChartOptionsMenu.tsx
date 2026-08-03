import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartCardDensity } from '../../stores/uiPreferencesStore';

interface ChartOptionsMenuProps {
  cardDensity: ChartCardDensity;
  onToggleDensity: () => void;
  onExpandAll: () => void;
  onExport: () => void;
  exporting: boolean;
  exportError: string | null;
}

// Consolidates the density toggle, "Expand all" and "Export as image" — three
// previously separate top-right buttons — behind one trigger, per a design
// follow-up once the density toggle (backlog item 51) made the stack four
// buttons deep. A kebab ("⋮", not a gear) on purpose: a gear/settings icon
// implies persistent configuration, but two of these three are one-off
// actions (expand, export), not settings — a plain-text glyph rather than an
// SVG matches this app's existing icon-free convention (✕, −, +).
export function ChartOptionsMenu({
  cardDensity,
  onToggleDensity,
  onExpandAll,
  onExport,
  exporting,
  exportError,
}: ChartOptionsMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Same capture-phase outside-click + Escape pattern as AccountMenu.tsx —
  // capture, not bubble, because chart controls elsewhere call
  // e.stopPropagation() in their own handlers, which would otherwise stop a
  // bubble-phase document listener from ever seeing the click (see CLAUDE.md
  // for the exact bug this fixed once already, on ContextMenu.tsx).
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const itemClass =
    'block w-full rounded px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-transparent';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t('chart.optionsMenu')}
        aria-label={t('chart.optionsMenu')}
        className="flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-lg leading-none text-slate-700 shadow-sm transition-shadow hover:bg-slate-50 hover:shadow-md"
      >
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              onToggleDensity();
              setOpen(false);
            }}
            className={itemClass}
          >
            {cardDensity === 'compact' ? t('chart.switchToDetailed') : t('chart.switchToCompact')}
          </button>
          <button
            type="button"
            onClick={() => {
              onExpandAll();
              setOpen(false);
            }}
            className={itemClass}
          >
            {t('chart.expandAll')}
          </button>
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            className={itemClass}
          >
            {exporting ? t('chart.exporting') : t('chart.export')}
          </button>
          {exportError && (
            <p className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-600">{exportError}</p>
          )}
        </div>
      )}
    </div>
  );
}
