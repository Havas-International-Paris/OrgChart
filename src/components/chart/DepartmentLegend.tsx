import type { Department } from '../../types/domain';

interface DepartmentLegendProps {
  departments: Department[];
  colorByName: Map<string, string>;
}

export function DepartmentLegend({ departments, colorByName }: DepartmentLegendProps) {
  if (departments.length === 0) return null;

  return (
    <div className="absolute left-2 top-2 z-10 max-w-[180px] rounded-md border border-slate-200 bg-white/90 px-2.5 py-2 text-xs shadow-sm backdrop-blur-sm">
      <p className="mb-1 font-semibold text-slate-500">Business Units</p>
      <ul className="space-y-0.5">
        {departments.map((d) => (
          <li key={d.id} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: colorByName.get(d.name) }}
            />
            <span className="truncate text-slate-600">{d.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
