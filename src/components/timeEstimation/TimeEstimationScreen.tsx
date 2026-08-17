import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegistryOrgChart } from '../../hooks/useRegistryOrgChart';
import { TimeEstimationGrid } from './TimeEstimationGrid';
import { ImportTimeActualsWizard } from './ImportTimeActualsWizard';
import { useTimeEstimationHistoryStore } from '../../stores/timeEstimationHistoryStore';
import { useTimeEstimationUndoRedoShortcuts } from '../../lib/history/useTimeEstimationUndoRedoShortcuts';
import { UndoRedoButtons } from '../shared/UndoRedoButtons';

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
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            {t('timeEstimation.importButton')}
          </button>
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
