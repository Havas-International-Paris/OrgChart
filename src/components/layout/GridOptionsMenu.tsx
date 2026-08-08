import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiPreferencesStore, type GridDensity } from '../../stores/uiPreferencesStore';

const DENSITY_IDS: GridDensity[] = ['comfortable', 'compact'];

interface GridOptionsMenuProps {
  viewMode: 'main' | 'config';
  onToggleViewMode: () => void;
}

// Same self-contained kebab pattern as the chart's ChartOptionsMenu.tsx —
// trigger + capture-phase outside-click/Escape popover (see that file / the
// AccountMenu.tsx comment it references for why capture, not bubble).
export function GridOptionsMenu({ viewMode, onToggleViewMode }: GridOptionsMenuProps) {
  const { t } = useTranslation();
  const gridDensity = useUiPreferencesStore((s) => s.gridDensity);
  const setGridDensity = useUiPreferencesStore((s) => s.setGridDensity);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const itemClass = 'block w-full rounded px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t('leftPanel.optionsMenu')}
        aria-label={t('leftPanel.optionsMenu')}
        className="flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-lg leading-none text-slate-700 shadow-sm transition-shadow hover:bg-slate-50 hover:shadow-md"
      >
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              onToggleViewMode();
              setOpen(false);
            }}
            className={itemClass}
          >
            {viewMode === 'config' ? t('leftPanel.switchToMain') : t('leftPanel.switchToConfig')}
          </button>
          <div className="my-1 border-t border-slate-100" />
          <div className="px-3 py-1 text-xs text-slate-400">{t('leftPanel.density.label')}</div>
          <div className="flex items-center gap-1 px-2 pb-1">
            {DENSITY_IDS.map((id) => (
              <button
                key={id}
                onClick={() => setGridDensity(id)}
                className={`rounded px-2 py-1 text-xs font-medium ${
                  gridDensity === id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                }`}
              >
                {t(`leftPanel.density.${id}`)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
