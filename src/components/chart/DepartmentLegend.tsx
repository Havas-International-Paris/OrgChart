import { useTranslation } from 'react-i18next';
import type { ChartColorBy } from '../../stores/uiPreferencesStore';

interface LegendItem {
  id: string;
  name: string;
}

interface DepartmentLegendProps {
  items: LegendItem[];
  colorByName: Map<string, string>;
  counts: Map<string, number>;
  selectedNames: Set<string>;
  onToggle: (name: string) => void;
  hint: string;
  colorBy: ChartColorBy;
  onColorByChange: (colorBy: ChartColorBy) => void;
}

// Both a color key AND the active dimension's filter control — clicking a
// chip toggles that department/company in selectionStore's
// deptFilterNames/companyFilterNames (item 42, extended for companies), the
// same fields the header's FiltersPanel edits, so the two stay in sync for
// free (shared state, not a separate local selection mirrored back). The
// leading two-button switcher (added alongside the Company dimension) picks
// which of those two dimensions this legend is currently coloring/filtering
// by — deliberately living here rather than the chart's kebab menu, so it
// sits right next to the chips it controls.
export function DepartmentLegend({
  items,
  colorByName,
  counts,
  selectedNames,
  onToggle,
  hint,
  colorBy,
  onColorByChange,
}: DepartmentLegendProps) {
  const { t } = useTranslation();

  return (
    // left-14 (56px) clears React Flow's own bottom-left <Controls> panel
    // (15px margin + 26px button width = 41px), which otherwise sits right
    // underneath this at the same corner.
    <div className="absolute bottom-2 left-14 z-10 flex max-w-[calc(100%-4rem)] flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-white/90 p-2 shadow-sm backdrop-blur-sm">
      <div className="flex shrink-0 overflow-hidden rounded border border-slate-300 text-[11px]">
        <button
          type="button"
          onClick={() => onColorByChange('department')}
          className={`px-2 py-1 font-semibold ${
            colorBy === 'department' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          {t('chart.legend.businessUnit')}
        </button>
        <button
          type="button"
          onClick={() => onColorByChange('company')}
          className={`px-2 py-1 font-semibold ${
            colorBy === 'company' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          {t('chart.legend.company')}
        </button>
      </div>
      {items.map((item) => {
        const color = colorByName.get(item.name) ?? '#94a3b8';
        const isSelected = selectedNames.has(item.name);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onToggle(item.name)}
            aria-pressed={isSelected}
            title={hint}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              isSelected
                ? 'border-slate-400 bg-slate-100 text-slate-900'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <span className="truncate">{item.name}</span>
            <span className="text-slate-400">{counts.get(item.name) ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}
