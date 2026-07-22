import type { Department } from '../../types/domain';
import { withAlpha } from '../../lib/departmentColor';

interface DepartmentLegendProps {
  departments: Department[];
  colorByName: Map<string, string>;
  counts: Map<string, number>;
  activeFilter: string | null;
  onToggle: (name: string) => void;
}

export function DepartmentLegend({
  departments,
  colorByName,
  counts,
  activeFilter,
  onToggle,
}: DepartmentLegendProps) {
  if (departments.length === 0) return null;

  return (
    <div className="absolute left-2 top-2 z-10 flex max-w-[420px] flex-wrap gap-1.5 rounded-md border border-slate-200 bg-white/90 p-2 shadow-sm backdrop-blur-sm">
      {departments.map((d) => {
        const color = colorByName.get(d.name) ?? '#94a3b8';
        const active = activeFilter === d.name;
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onToggle(d.name)}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors"
            style={{
              borderColor: active ? color : '#e2e8f0',
              backgroundColor: active ? withAlpha(color, 0.15) : '#fff',
              color: '#334155',
            }}
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
