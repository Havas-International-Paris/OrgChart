import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAssignments } from '../../hooks/useAssignments';
import { useEmployees } from '../../hooks/useEmployees';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUiPreferencesStore } from '../../stores/uiPreferencesStore';
import type { Assignment, Employee } from '../../types/domain';

type GroupBy = 'client' | 'employee';

interface RowInfo {
  id: string;
  counterpartLabel: string;
  remunerationModel: Assignment['remuneration_model'];
  etpVendu: number | null;
  etpReel: number | null;
}

interface Group {
  key: string;
  label: string;
  rows: RowInfo[];
  totalVendu: number;
  hasVendu: boolean;
  totalReel: number;
  hasReel: boolean;
}

function employeeName(employee: Employee | undefined): string {
  return employee ? `${employee.first_name} ${employee.last_name}` : '?';
}

function remunerationLabel(model: Assignment['remuneration_model'], t: (key: string) => string): string {
  return model === 'commission'
    ? t('grid.allocations.commission')
    : model === 'retainer'
      ? t('grid.allocations.retainer')
      : '—';
}

const ROW_GRID = 'grid grid-cols-[1fr_100px_70px_70px] gap-2 items-center';

export function AllocationsView() {
  const { t } = useTranslation();
  const currentOrgChartId = useSelectionStore((s) => s.currentOrgChartId);
  const { assignments, loading: assignmentsLoading } = useAssignments(currentOrgChartId);
  const { employees, loading: employeesLoading } = useEmployees(currentOrgChartId);
  const { clientsMissions, loading: clientsMissionsLoading } = useClientsMissions();
  const hideDepartedEmployees = useUiPreferencesStore((s) => s.hideDepartedEmployees);
  const [groupBy, setGroupBy] = useState<GroupBy>('client');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const clientMissionById = useMemo(
    () => new Map(clientsMissions.map((cm) => [cm.id, cm])),
    [clientsMissions],
  );

  const visibleAssignments = useMemo(
    () =>
      hideDepartedEmployees ? assignments.filter((a) => !employeeById.get(a.employee_id)?.has_left_company) : assignments,
    [assignments, hideDepartedEmployees, employeeById],
  );

  const groups = useMemo<Group[]>(() => {
    const buckets = new Map<string, Assignment[]>();
    for (const a of visibleAssignments) {
      const key = groupBy === 'client' ? a.client_mission_id : a.employee_id;
      const list = buckets.get(key);
      if (list) list.push(a);
      else buckets.set(key, [a]);
    }

    const result: Group[] = [];
    for (const [key, rows] of buckets) {
      const label =
        groupBy === 'client' ? (clientMissionById.get(key)?.name ?? '?') : employeeName(employeeById.get(key));

      const rowInfos: RowInfo[] = rows.map((a) => {
        if (groupBy === 'client') {
          return {
            id: a.id,
            counterpartLabel: employeeName(employeeById.get(a.employee_id)),
            remunerationModel: a.remuneration_model,
            etpVendu: a.etp_vendu,
            etpReel: a.etp_reel,
          };
        }
        const cm = clientMissionById.get(a.client_mission_id);
        return {
          id: a.id,
          counterpartLabel: cm?.name ?? '?',
          remunerationModel: a.remuneration_model,
          etpVendu: a.etp_vendu,
          etpReel: a.etp_reel,
        };
      });

      const venduKnown = rows.filter((a) => a.etp_vendu !== null);
      const reelKnown = rows.filter((a) => a.etp_reel !== null);

      result.push({
        key,
        label,
        rows: rowInfos.sort((a, b) => a.counterpartLabel.localeCompare(b.counterpartLabel)),
        totalVendu: venduKnown.reduce((sum, a) => sum + (a.etp_vendu ?? 0), 0),
        hasVendu: venduKnown.length > 0,
        totalReel: reelKnown.reduce((sum, a) => sum + (a.etp_reel ?? 0), 0),
        hasReel: reelKnown.length > 0,
      });
    }

    return result.sort((a, b) => a.label.localeCompare(b.label));
  }, [visibleAssignments, groupBy, employeeById, clientMissionById]);

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.key));

  function toggleAllGroups() {
    setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.key)));
  }

  const loading = assignmentsLoading || employeesLoading || clientsMissionsLoading;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">{t('grid.allocations.title')}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAllGroups}
            className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {allCollapsed ? t('grid.allocations.expandAll') : t('grid.allocations.collapseAll')}
          </button>
          <div className="flex overflow-hidden rounded border border-slate-300 text-xs">
            <button
              onClick={() => setGroupBy('client')}
              className={`px-2.5 py-1 font-medium ${
                groupBy === 'client' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t('grid.allocations.byClient')}
            </button>
            <button
              onClick={() => setGroupBy('employee')}
              className={`px-2.5 py-1 font-medium ${
                groupBy === 'employee' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t('grid.allocations.byEmployee')}
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-200">
        <div
          className={`sticky top-0 z-10 border-b border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 ${ROW_GRID}`}
        >
          <span>{groupBy === 'client' ? t('grid.allocations.employeeHeader') : t('grid.allocations.clientMissionHeader')}</span>
          <span>{t('grid.allocations.model')}</span>
          <span className="text-right">{t('grid.allocations.percentSold')}</span>
          <span className="text-right">{t('grid.allocations.percentActual')}</span>
        </div>

        {loading && <p className="p-3 text-sm text-slate-400">{t('grid.allocations.loading')}</p>}
        {!loading && groups.length === 0 && (
          <p className="p-3 text-sm text-slate-400">{t('grid.allocations.empty')}</p>
        )}
        {!loading &&
          groups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            return (
              <div key={group.key} className="border-b border-slate-100 last:border-0">
                <button
                  onClick={() => toggleGroup(group.key)}
                  className={`w-full bg-slate-50 px-3 py-2 text-left hover:bg-slate-100 ${ROW_GRID}`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="text-slate-400">{isCollapsed ? '▸' : '▾'}</span>
                    <span className="truncate text-sm font-semibold text-slate-800">{group.label}</span>
                    <span className="shrink-0 text-xs text-slate-400">· {group.rows.length}</span>
                  </span>
                  <span />
                  <span className="text-right text-xs text-slate-500">
                    {group.hasVendu ? `${group.totalVendu}%` : '—'}
                  </span>
                  <span className="text-right text-xs text-slate-400">
                    {group.hasReel ? `${group.totalReel}%` : '—'}
                  </span>
                </button>
                {!isCollapsed &&
                  group.rows.map((row) => (
                    <div key={row.id} className={`border-t border-slate-100 px-3 py-1.5 pl-8 text-sm ${ROW_GRID}`}>
                      <span className="truncate text-slate-700">{row.counterpartLabel}</span>
                      <span className="text-xs text-slate-400">{remunerationLabel(row.remunerationModel, t)}</span>
                      <span className="text-right text-xs text-slate-600">
                        {row.etpVendu === null ? '—' : `${row.etpVendu}%`}
                      </span>
                      <span className="text-right text-xs text-slate-400">
                        {row.etpReel === null ? '—' : `${row.etpReel}%`}
                      </span>
                    </div>
                  ))}
              </div>
            );
          })}
      </div>
    </div>
  );
}
