import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { isSupabaseConfigured } from '../../lib/supabaseClient';
import { useAuth } from '../../hooks/useAuth';
import { useEmployees } from '../../hooks/useEmployees';
import { useAssignments } from '../../hooks/useAssignments';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { useOrgCharts } from '../../hooks/useOrgCharts';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUiPreferencesStore } from '../../stores/uiPreferencesStore';
import { useHistoryStore } from '../../stores/historyStore';
import { resetIdRegistry } from '../../stores/idRegistryStore';
import { useUndoRedoShortcuts } from '../../lib/history/useUndoRedoShortcuts';
import { LoginPage } from '../auth/LoginPage';
import { SupabaseSetupNotice } from '../auth/SupabaseSetupNotice';
import { LeftPanel } from './LeftPanel';
import { OrgChartManagerModal } from './OrgChartManagerModal';
import { OrgChartView } from '../chart/OrgChartView';
import { SearchBar } from '../shared/SearchBar';
import { ClientMissionFilter } from '../shared/ClientMissionFilter';
import { AssignmentEditorModal } from '../shared/AssignmentEditorModal';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { Toast } from '../shared/Toast';

function LoadingScreen({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center text-slate-500">{label}</div>;
}

// Auth gate only. Everything that reads data lives in AuthenticatedApp below and
// is mounted ONLY once a session exists — that ordering is the whole point, not
// a stylistic choice.
//
// The data hooks fetch on mount and (for the global catalogs) never refetch, so
// mounting them while still anonymous meant every RLS-protected table came back
// empty — `auth.role() = 'authenticated'` denies, which PostgREST reports as a
// perfectly successful 200 carrying zero rows, no error anywhere. Signing in
// then produced a session but nothing re-ran the fetches, so `orgCharts` stayed
// empty and the app sat on "Chargement…" forever. It only ever worked because a
// returning browser already had a session in localStorage at mount; a fresh
// browser, a private window, cleared storage or an expired refresh token all hit
// the hang. Found by the first authenticated E2E run.
//
// `key` on the user id so signing in as somebody else remounts the whole subtree
// rather than reusing another account's fetched data.
export function AppShell() {
  const { session, loading, signOut } = useAuth();

  if (!isSupabaseConfigured) {
    return <SupabaseSetupNotice />;
  }

  if (loading) {
    return <LoadingScreen label="Vérification de la session…" />;
  }

  if (!session) {
    return <LoginPage />;
  }

  return <AuthenticatedApp key={session.user.id} signOut={signOut} />;
}

function AuthenticatedApp({ signOut }: { signOut: () => void }) {
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
  const resetHistory = useHistoryStore((s) => s.reset);
  // Undo/redo history (and the id registry it depends on) is chart-relative,
  // like selectionStore's own fields — routing every chart switch through
  // this one wrapper guarantees a future call site can't forget the reset.
  const switchOrgChart = (id: string) => {
    resetHistory();
    resetIdRegistry();
    setCurrentOrgChartId(id);
  };
  useUndoRedoShortcuts();
  const { employees } = useEmployees(currentOrgChartId);
  const {
    assignmentsOf,
    createAssignment,
    updateAssignmentEtpVendu,
    updateAssignmentEtpReel,
    updateAssignmentRemuneration,
    deleteAssignment,
  } = useAssignments(currentOrgChartId);
  const { clientsMissions, findOrCreate, createClientMission, deleteClientMission } = useClientsMissions();
  const assignmentsEmployeeId = useSelectionStore((s) => s.assignmentsEmployeeId);
  const setAssignmentsEmployeeId = useSelectionStore((s) => s.setAssignmentsEmployeeId);
  const [managingCharts, setManagingCharts] = useState(false);
  const splitFraction = useUiPreferencesStore((s) => s.splitFraction);
  const setSplitFraction = useUiPreferencesStore((s) => s.setSplitFraction);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  function handleDividerPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleDividerPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.buttons !== 1 || !splitContainerRef.current) return;
    const rect = splitContainerRef.current.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    setSplitFraction(Math.min(0.75, Math.max(0.2, fraction)));
  }

  useEffect(() => {
    if (!currentOrgChartId && orgCharts.length > 0) {
      switchOrgChart(orgCharts[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrgChartId, orgCharts]);

  // Each waiting state says which one it is. They all used to read "Chargement…",
  // which made the hang above genuinely hard to place: the page gave no way to
  // tell "still checking the session" from "session fine, no chart to open".
  if (orgChartsLoading) {
    return <LoadingScreen label="Chargement des organigrammes…" />;
  }

  // A signed-in user with no chart at all would otherwise sit on a spinner
  // forever, since nothing can be selected. Reachable by deleting the last
  // chart, and previously indistinguishable from a network stall.
  if (orgCharts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
        <p>Aucun organigramme n’existe encore.</p>
        <p className="text-slate-400">Créez-en un pour commencer.</p>
      </div>
    );
  }

  if (!currentOrgChartId) {
    return <LoadingScreen label="Ouverture de l’organigramme…" />;
  }

  const assignmentsEmployee = employees.find((e) => e.id === assignmentsEmployeeId) ?? null;

  async function handleDeleteOrgChart(id: string) {
    await deleteOrgChart(id);
    if (id === currentOrgChartId) {
      const remaining = orgCharts.filter((c) => c.id !== id);
      if (remaining.length > 0) switchOrgChart(remaining[0].id);
    }
  }

  async function handleCreateOrgChart(name: string, shortLabel: string) {
    const created = await createOrgChart(name, shortLabel);
    switchOrgChart(created.id);
  }

  async function handleDuplicateOrgChart(sourceId: string, newName: string, newShortLabel: string) {
    const newId = await duplicateOrgChart(sourceId, newName, newShortLabel);
    switchOrgChart(newId);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <h1 className="text-sm font-semibold text-slate-900">Organigramme Havas International</h1>
        <div className="flex items-center gap-3">
          <select
            value={currentOrgChartId}
            onChange={(e) => switchOrgChart(e.target.value)}
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
          <ClientMissionFilter orgChartId={currentOrgChartId} />
          <button
            onClick={() => signOut()}
            className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            Déconnexion
          </button>
        </div>
      </header>
      <div ref={splitContainerRef} className="flex flex-1 overflow-hidden">
        <section
          className="overflow-auto border-r border-slate-200 p-4"
          style={{ width: `${splitFraction * 100}%` }}
        >
          <LeftPanel />
        </section>
        <div
          onPointerDown={handleDividerPointerDown}
          onPointerMove={handleDividerPointerMove}
          className="w-1.5 shrink-0 cursor-col-resize bg-slate-200 hover:bg-slate-300 active:bg-slate-400"
          title="Redimensionner"
        />
        <section className="min-w-0 flex-1 overflow-hidden">
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
          orgChartId={currentOrgChartId}
          findOrCreate={findOrCreate}
          createClientMission={createClientMission}
          deleteClientMission={deleteClientMission}
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
      <Toast />
    </div>
  );
}
