import type { Department } from '../../types/domain';

interface DepartmentLegendProps {
  departments: Department[];
  colorByName: Map<string, string>;
  counts: Map<string, number>;
  selectedNames: Set<string>;
  onToggle: (name: string) => void;
}

// Both a color key AND the Business Unit filter control — clicking a chip
// toggles that department in selectionStore's deptFilterNames (item 42),
// the same field the header's FiltersPanel edits, so the two stay in sync
// for free (shared state, not a separate local selection mirrored back).
export function DepartmentLegend({ departments, colorByName, counts, selectedNames, onToggle }: DepartmentLegendProps) {
  if (departments.length === 0) return null;

  return (
    <div className="absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap gap-1.5 rounded-md border border-slate-200 bg-white/90 p-2 shadow-sm backdrop-blur-sm">
      {departments.map((d) => {
        const color = colorByName.get(d.name) ?? '#94a3b8';
        const isSelected = selectedNames.has(d.name);
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onToggle(d.name)}
            aria-pressed={isSelected}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              isSelected
                ? 'border-slate-400 bg-slate-100 text-slate-900'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <span className="truncate">{d.name}</span>
            <span className="text-slate-400">{counts.get(d.name) ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}
