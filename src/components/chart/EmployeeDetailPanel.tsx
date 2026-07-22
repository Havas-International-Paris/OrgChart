import type { ReactNode } from 'react';
import { NEUTRAL_DEPARTMENT_COLOR, withAlpha } from '../../lib/departmentColor';
import type { Employee } from '../../types/domain';

function PersonRow({
  employee,
  dashed,
  onSelect,
}: {
  employee: Employee;
  dashed: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(employee.id)}
      className="flex w-full items-start gap-2 rounded px-1 py-1 text-left hover:bg-slate-50"
    >
      <span className={`mt-2 h-0 w-3 shrink-0 border-t-2 border-slate-400 ${dashed ? 'border-dashed' : ''}`} />
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-slate-700">
          {employee.first_name} {employee.last_name}
        </span>
        {employee.job_title && (
          <span className="block truncate text-[11px] text-slate-500">{employee.job_title}</span>
        )}
      </span>
    </button>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</h3>
      <div className="mt-1.5 space-y-0.5">{children}</div>
    </section>
  );
}

export interface EmployeeDetailPanelProps {
  employee: Employee;
  departmentColor: string | null;
  manager: Employee | null;
  functionalManagers: Employee[];
  directReports: Employee[];
  functionalReports: Employee[];
  onClose: () => void;
  onSelectEmployee: (id: string) => void;
}

export function EmployeeDetailPanel({
  employee,
  departmentColor,
  manager,
  functionalManagers,
  directReports,
  functionalReports,
  onClose,
  onSelectEmployee,
}: EmployeeDetailPanelProps) {
  const swatch = departmentColor ?? NEUTRAL_DEPARTMENT_COLOR;

  return (
    <div
      data-row-stabilizer-ignore
      className="absolute right-3 top-16 z-20 max-h-[calc(100%-80px)] w-[300px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-500 hover:bg-slate-200"
      >
        ✕
      </button>

      <h2 className="pr-6 text-base font-bold text-slate-900">
        {employee.first_name} {employee.last_name}
      </h2>
      {employee.job_title && <p className="mt-0.5 text-xs text-slate-500">{employee.job_title}</p>}
      {employee.department && (
        <span
          className="mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={{ backgroundColor: withAlpha(swatch, 0.15), color: swatch }}
        >
          {employee.department}
        </span>
      )}

      {manager && (
        <Section label="Manager direct">
          <PersonRow employee={manager} dashed={false} onSelect={onSelectEmployee} />
        </Section>
      )}

      {functionalManagers.length > 0 && (
        <Section label="Manager(s) fonctionnel(s)">
          {functionalManagers.map((m) => (
            <PersonRow key={m.id} employee={m} dashed onSelect={onSelectEmployee} />
          ))}
        </Section>
      )}

      {directReports.length > 0 && (
        <Section label={`Subordonnés directs (${directReports.length})`}>
          {directReports.map((r) => (
            <PersonRow key={r.id} employee={r} dashed={false} onSelect={onSelectEmployee} />
          ))}
        </Section>
      )}

      {functionalReports.length > 0 && (
        <Section label={`Subordonnés fonctionnels entrants (${functionalReports.length})`}>
          {functionalReports.map((r) => (
            <PersonRow key={r.id} employee={r} dashed onSelect={onSelectEmployee} />
          ))}
        </Section>
      )}
    </div>
  );
}
