import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface FilterDropdownOption {
  key: string;
  label: string;
  badge?: string;
  swatch?: string;
}

interface FilterDropdownProps {
  title: string;
  // Native tooltip on the button — used by FiltersBar's Business Unit
  // instance (item 55) to clarify it's the same filter as the chart's own
  // DepartmentLegend swatches, not a separate one. Optional since the other
  // two instances (Poste, Client/Mission) have no such counterpart to explain.
  hint?: string;
  options: FilterDropdownOption[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  // Optional "select all / deselect all" row above the option list — caller
  // supplies both handlers AND both labels (kept translation-agnostic like
  // every other string this component renders); only shows when all four
  // are provided, so existing callers (FiltersBar's BU/Poste/Client-Mission)
  // are unaffected without any change on their part.
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  selectAllLabel?: string;
  deselectAllLabel?: string;
}

// One reusable dropdown filter — Business Unit, Poste, and Client/Mission
// each render one of these side by side in FiltersBar.tsx. Collapsed by
// default ("repliés" per the user's own framing of a classic filter bar):
// only the button (label + a count-of-selected badge) shows until clicked,
// at which point its own small popover opens directly below IT, not the
// whole bar — independent from its siblings, so opening Business Unit's
// list doesn't affect Poste's own collapsed state. Same open/close/
// outside-click pattern the old standalone ClientMissionFilter.tsx/
// DepartmentFilter.tsx each used to own individually.
export function FilterDropdown({
  title,
  hint,
  options,
  selected,
  onToggle,
  onSelectAll,
  onDeselectAll,
  selectAllLabel,
  deselectAllLabel,
}: FilterDropdownProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Query resets on close so the next open always starts from the full list,
  // same as LinkExistingEmployeeModal/ManagerEditorModal's own search input.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  if (options.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={hint}
        className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
      >
        {title}
        {selected.size > 0 && (
          <span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-[11px] font-semibold text-white">
            {selected.size}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-80 w-64 overflow-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('filters.searchPlaceholder')}
            autoFocus
            className="mb-1.5 w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-slate-400 focus:outline-none"
          />
          {onSelectAll && onDeselectAll && (
            <div className="mb-1.5 flex items-center justify-between border-b border-slate-100 pb-1.5 text-xs">
              <button type="button" onClick={onSelectAll} className="text-slate-500 hover:text-slate-800 hover:underline">
                {selectAllLabel}
              </button>
              <button type="button" onClick={onDeselectAll} className="text-slate-500 hover:text-slate-800 hover:underline">
                {deselectAllLabel}
              </button>
            </div>
          )}
          {filteredOptions.length === 0 && (
            <div className="px-1.5 py-1 text-sm text-slate-400">{t('filters.noMatch')}</div>
          )}
          {filteredOptions.map((option) => {
            const checked = selected.has(option.key);
            return (
              <label
                key={option.key}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(option.key)}
                  className="shrink-0"
                />
                {option.swatch && (
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: option.swatch }} />
                )}
                <span className="flex-1 truncate">{option.label}</span>
                {option.badge && <span className="shrink-0 text-[11px] text-slate-400">{option.badge}</span>}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
