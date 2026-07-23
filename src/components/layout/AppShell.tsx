import { useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../../lib/supabaseClient';
import { useAuth } from '../../hooks/useAuth';
import { useEmployees } from '../../hooks/useEmployees';
import { useAssignments } from '../../hooks/useAssignments';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { useOrgCharts } from '../../hooks/useOrgCharts';
import { useSelectionStore } from '../../stores/selectionStore';
import { LoginPage } from '../auth/LoginPage';
import { SupabaseSetupNotice } from '../auth/SupabaseSetupNotice';
import { LeftPanel } from './LeftPanel';
import { OrgChartManagerModal } from './OrgChartManagerModal';
import { OrgChartView } from '../chart/OrgChartView';
import { SearchBar } from '../shared/SearchBar';
import { AssignmentEditorModal } from '../shared/AssignmentEditorModal';
import { ErrorBoundary } from '../shared/ErrorBoundary';

export function AppShell() {
  const { session, loading, signOut } = useAuth();
  const {
    orgCharts,
    loading: orgChartsLoading,
    createOrgChart,
    updateOrgChart,
    duplicateOrgChart,
    deleteOrgChart,
  } = useOrgCharts();
  const currentOrgChartId = useSelectionStore((s) => s.currentOrgChartId);
  const setCurrentOrgChartId = useSelectionStore((s) => s.setCurrentOrgChartId);
  const { employees } = useEmployees(currentOrgChartId);
  const {
    assignmentsOf,
    createAssignment,
    updateAssignmentEtpVendu,
    updateAssignmentEtpReel,
    updateAssignmentRemuneration,
    deleteAssignment,
  } = useAssignments(currentOrgChartId);
  const { clientsMissions, findOrCreate } = useClientsMissions();
  const assignmentsEmployeeId = useSelectionStore((s) => s.assignmentsEmployeeId);
  const setAssignmentsEmployeeId = useSelectionStore((s) => s.setAssignmentsEmployeeId);
  const [managingCharts, setManagingCharts] = useState(false);

  useEffect(() => {
    if (!currentOrgChartId && orgCharts.length > 0) {
      setCurrentOrgChartId(orgCharts[0].id);
    }
  }, [currentOrgChartId, orgCharts, setCurrentOrgChartId]);

  if (!isSupabaseConfigured) {
    return <SupabaseSetupNotice />;
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-slate-500">Chargement…</div>;
  }

  if (!session) {
    return <LoginPage />;
  }

  if (orgChartsLoading || !currentOrgChartId) {
    return <div className="flex h-full items-center justify-center text-slate-500">Chargement…</div>;
  }

  const assignmentsEmployee = employees.find((e) => e.id === assignmentsEmployeeId) ?? null;

  async function handleDeleteOrgChart(id: string) {
    await deleteOrgChart(id);
    if (id === currentOrgChartId) {
      const remaining = orgCharts.filter((c) => c.id !== id);
      if (remaining.length > 0) setCurrentOrgChartId(remaining[0].id);
    }
  }

  async function handleCreateOrgChart(name: string, shortLabel: string) {
    const created = await createOrgChart(name, shortLabel);
    setCurrentOrgChartId(created.id);
  }

  async function handleDuplicateOrgChart(sourceId: string, newName: string, newShortLabel: string) {
    const newId = await duplicateOrgChart(sourceId, newName, newShortLabel);
    setCurrentOrgChartId(newId);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <h1 className="text-sm font-semibold text-slate-900">Organigramme Havas International</h1>
        <div className="flex items-center gap-3">
          <select
            value={currentOrgChartId}
            onChange={(e) => setCurrentOrgChartId(e.target.value)}
            title={orgCharts.find((c) => c.id === currentOrgChartId)?.name}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700"
          >
            {orgCharts.map((chart) => (
              <option key={chart.id} value={chart.id} title={chart.name}>
                {chart.short_label ? `${chart.name} – ${chart.short_label}` : chart.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setManagingCharts(true)}
            className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            Gérer
          </button>
          <SearchBar />
          <button
            onClick={() => signOut()}
            className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            Déconnexion
          </button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <section className="w-1/2 overflow-auto border-r border-slate-200 p-4">
          <LeftPanel />
        </section>
        <section className="w-1/2 overflow-hidden">
          <ErrorBoundary>
            <OrgChartView />
          </ErrorBoundary>
        </section>
      </div>
      {assignmentsEmployee && (
        <AssignmentEditorModal
          employee={assignmentsEmployee}
          assignments={assignmentsOf(assignmentsEmployee.id)}
          clientsMissions={clientsMissions}
          findOrCreate={findOrCreate}
          createAssignment={createAssignment}
          updateAssignmentEtpVendu={updateAssignmentEtpVendu}
          updateAssignmentEtpReel={updateAssignmentEtpReel}
          updateAssignmentRemuneration={updateAssignmentRemuneration}
          deleteAssignment={deleteAssignment}
          onClose={() => setAssignmentsEmployeeId(null)}
        />
      )}
      {managingCharts && (
        <OrgChartManagerModal
          orgCharts={orgCharts}
          currentOrgChartId={currentOrgChartId}
          onCreate={handleCreateOrgChart}
          onRename={updateOrgChart}
          onDuplicate={handleDuplicateOrgChart}
          onDelete={handleDeleteOrgChart}
          onClose={() => setManagingCharts(false)}
        />
      )}
    </div>
  );
}
