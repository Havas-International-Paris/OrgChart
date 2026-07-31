import { useEffect, useRef, useState } from 'react';

export interface FilterDropdownOption {
  key: string;
  label: string;
  badge?: string;
  swatch?: string;
}

interface FilterDropdownProps {
  title: string;
  options: FilterDropdownOption[];
  selected: Set<string>;
  onToggle: (key: string) => void;
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
export function FilterDropdown({ title, options, selected, onToggle }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  if (options.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
          {options.map((option) => {
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
