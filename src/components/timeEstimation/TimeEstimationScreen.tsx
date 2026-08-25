import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegistryOrgChart } from '../../hooks/useRegistryOrgChart';
import { useEmployees } from '../../hooks/useEmployees';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { useTimeEstimation } from '../../hooks/useTimeEstimation';
import { TimeEstimationGrid } from './TimeEstimationGrid';
import { ImportTimeActualsWizard } from './ImportTimeActualsWizard';
import { useTimeEstimationHistoryStore } from '../../stores/timeEstimationHistoryStore';
import { useTimeEstimationUndoRedoShortcuts } from '../../lib/history/useTimeEstimationUndoRedoShortcuts';
import { UndoRedoButtons } from '../shared/UndoRedoButtons';
import { buildTimeEstimationWorkbook, downloadTimeEstimationWorkbook } from '../../lib/exportTimeEstimationXlsx';

// Full-screen replacement for the grid/chart split, same precedent as
// AccessManagementScreen.tsx — reached from AccountMenu's admin-only entry.
// Admin-only both client-side (the menu item itself, gated on role) and
// server-side (every table this reads/writes requires is_active_admin(),
// see 0021_time_estimation.sql).
export function TimeEstimationScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { registryOrgChart, loading } = useRegistryOrgChart();
  const [importOpen, setImportOpen] = useState(false);
  // This screen's own Cmd/Ctrl+Z — fully independent from the org-chart/
  // grid screen's (AppShell.tsx's useUndoRedoShortcuts), and safe to call
  // unconditionally since this component only ever mounts while the screen
  // itself is showing.
  useTimeEstimationUndoRedoShortcuts();

  // Own data fetch for the export button, independent of TimeEstimationGrid's
  // — same "every consumer loads the full table" pattern as EmployeeGrid/
  // OrgChartView both calling useEmployees() (see CLAUDE.md). The export is
  // a raw dump of the whole module's tables, not the grid's derived/filtered
  // view, so it needs the underlying data here rather than reading it out of
  // the grid component.
  const { employees: registryEmployees } = useEmployees(registryOrgChart?.id ?? null);
  const { clientsMissions } = useClientsMissions();
  const timeEstimationData = useTimeEstimation();
  const employeeById = useMemo(() => new Map(registryEmployees.map((e) => [e.id, e])), [registryEmployees]);
  const clientMissionById = useMemo(() => new Map(clientsMissions.map((cm) => [cm.id, cm])), [clientsMissions]);

  function handleExport() {
    const wb = buildTimeEstimationWorkbook({
      timeActuals: timeEstimationData.timeActuals,
      timeForecasts: timeEstimationData.timeForecasts,
      timeForecastMonths: timeEstimationData.timeForecastMonths,
      timeActualN1Totals: timeEstimationData.timeActualN1Totals,
      timeActualGroups: timeEstimationData.timeActualGroups,
      timeImportBatches: timeEstimationData.timeImportBatches,
      employeeAliases: timeEstimationData.employeeAliases,
      clientAliases: timeEstimationData.clientAliases,
      timeManualEditMarkers: timeEstimationData.timeManualEditMarkers,
      timeManualRows: timeEstimationData.timeManualRows,
      timeRowComments: timeEstimationData.timeRowComments,
      employeeById,
      clientMissionById,
    });
    const date = new Date().toISOString().slice(0, 10);
    downloadTimeEstimationWorkbook(wb, `estimation_des_temps_export_${date}.xlsx`);
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="text-sm font-medium text-slate-600 hover:text-slate-900">
            {t('timeEstimation.backToApp')}
          </button>
          <UndoRedoButtons useStore={useTimeEstimationHistoryStore} />
        </div>
        {registryOrgChart && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t('timeEstimation.exportButton')}
            </button>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
            >
              {t('timeEstimation.importButton')}
            </button>
          </div>
        )}
      </div>
      <h1 className="mb-4 text-lg font-semibold text-slate-900">{t('appShell.timeEstimation')}</h1>

      <div className="min-h-0 flex-1">
        {loading && <p className="text-sm text-slate-400">{t('timeEstimation.loadingRegistry')}</p>}
        {!loading && !registryOrgChart && <p className="text-sm text-slate-400">{t('timeEstimation.noRegistry')}</p>}
        {!loading && registryOrgChart && <TimeEstimationGrid registryOrgChartId={registryOrgChart.id} />}
      </div>

      {importOpen && registryOrgChart && (
        <ImportTimeActualsWizard registryOrgChartId={registryOrgChart.id} onClose={() => setImportOpen(false)} />
      )}
    </div>
  );
}
