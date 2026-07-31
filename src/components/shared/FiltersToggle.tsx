import { useTranslation } from 'react-i18next';
import { useActiveFilterCount } from '../../hooks/useActiveFilterCount';

interface FiltersToggleProps {
  open: boolean;
  onToggle: () => void;
}

// The header button that expands/collapses FiltersBar.tsx below it — lives
// in AppShell.tsx's main header row (next to search), while the bar itself
// renders as a full-width sibling of <header>, not a floating popover under
// this button. That's deliberate: the user asked for clicking "Filtres" to
// make the header's own bottom edge move down, revealing a classic filter
// bar, rather than opening a dropdown panel.
export function FiltersToggle({ open, onToggle }: FiltersToggleProps) {
  const { t } = useTranslation();
  const activeFilterCount = useActiveFilterCount();

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-sm ${
        open ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      {t('filters.button')}
      {activeFilterCount > 0 && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
            open ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'
          }`}
        >
          {activeFilterCount}
        </span>
      )}
    </button>
  );
}
