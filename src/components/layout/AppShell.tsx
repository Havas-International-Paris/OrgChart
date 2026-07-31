import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isSupabaseConfigured } from '../../lib/supabaseClient';
import { useAuth } from '../../hooks/useAuth';
import { useEmployees } from '../../hooks/useEmployees';
import { useAssignments } from '../../hooks/useAssignments';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { useOrgCharts } from '../../hooks/useOrgCharts';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUiPreferencesStore } from '../../stores/uiPreferencesStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useUndoRedoShortcuts } from '../../lib/history/useUndoRedoShortcuts';
import { LoginPage } from '../auth/LoginPage';
import { SupabaseSetupNotice } from '../auth/SupabaseSetupNotice';
import { LeftPanel } from './LeftPanel';
import { OrgChartManagerModal } from './OrgChartManagerModal';
import { OrgChartView } from '../chart/OrgChartView';
import { SearchBar } from '../shared/SearchBar';
import { FiltersToggle } from '../shared/FiltersToggle';
import { FiltersBar } from '../shared/FiltersBar';
import { UndoRedoButtons } from '../shared/UndoRedoButtons';
import { AssignmentEditorModal } from '../shared/AssignmentEditorModal';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { Toast } from '../shared/Toast';
import { LanguageSwitcher } from '../shared/LanguageSwitcher';

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
  const { t } = useTranslation();
  const { session, loading, signOut } = useAuth();

  if (!isSupabaseConfigured) {
    return <SupabaseSetupNotice />;
  }

  if (loading) {
    return <LoadingScreen label={t('appShell.verifyingSession')} />;
  }

  if (!session) {
    return <LoginPage />;
  }

  return <AuthenticatedApp key={session.user.id} signOut={signOut} />;
}

function AuthenticatedApp({ signOut }: { signOut: () => void }) {
  const { t } = useTranslation();
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
  // Undo/redo history is chart-relative, like selectionStore's own fields —
  // routing every chart switch through this one wrapper guarantees a future call
  // site can't forget the reset.
  const switchOrgChart = (id: string) => {
    resetHistory();
    setCurrentOrgChartId(id);
  };
  useUndoRedoShortcuts();
  const { employees } = useEmployees(currentOrgChartId);
  const {
    assignmentsOf,
    createAssignment,
    restoreAssignment,
    updateAssignmentEtpVendu,
    updateAssignmentEtpReel,
    updateAssignmentRemuneration,
    deleteAssignment,
  } = useAssignments(currentOrgChartId);
  const { clientsMissions, findOrCreate, restoreClientMission, deleteClientMission } = useClientsMissions();
  const assignmentsEmployeeId = useSelectionStore((s) => s.assignmentsEmployeeId);
  const setAssignmentsEmployeeId = useSelectionStore((s) => s.setAssignmentsEmployeeId);
  const [managingCharts, setManagingCharts] = useState(false);
  // Purely ephemeral UI state (not persisted, not chart-relative) — whether
  // FiltersBar.tsx's expandable row is showing. The underlying filter VALUES
  // live in selectionStore (reset on chart switch); whether the bar is open
  // doesn't need to survive a chart switch or a reload, so a plain useState
  // here is enough, unlike every other field selectionStore already owns.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const splitFraction = useUiPreferencesStore((s) => s.splitFraction);
  const setSplitFraction = useUiPreferencesStore((s) => s.setSplitFraction);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  function handleDividerPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // Without this, the mousedown-then-drag that starts a resize is
    // indistinguishable from a text-selection drag to the browser — the
    // grid's own text ends up selected as the cursor sweeps across it.
    e.preventDefault();
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
    return <LoadingScreen label={t('appShell.loadingOrgCharts')} />;
  }

  // A signed-in user with no chart at all would otherwise sit on a spinner
  // forever, since nothing can be selected. Reachable by deleting the last
  // chart, and previously indistinguishable from a network stall.
  if (orgCharts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
        <p>{t('appShell.noOrgChartsTitle')}</p>
        <p className="text-slate-400">{t('appShell.noOrgChartsSubtitle')}</p>
      </div>
    );
  }

  if (!currentOrgChartId) {
    return <LoadingScreen label={t('appShell.openingOrgChart')} />;
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
        <h1 className="text-sm font-semibold text-slate-900">{t('appShell.title')}</h1>
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
            {t('appShell.manage')}
          </button>
          <SearchBar />
          <FiltersToggle open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} />
          {/* Undo/redo applies globally (one shared historyStore) to both
              the grid and the chart — a single instance here, not one
              duplicated in each panel, matches that: there is exactly one
              history to show, regardless of which panel the user is
              looking at. */}
          <UndoRedoButtons />
          <LanguageSwitcher />
          <button
            onClick={() => signOut()}
            className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            {t('appShell.signOut')}
          </button>
        </div>
      </header>
      {/* Renders as a full-width row directly below <header>, not a
          floating popover — this is what makes the header's own bottom
          edge move down when "Filtres" is toggled, per the user's request. */}
      {filtersOpen && <FiltersBar orgChartId={currentOrgChartId} />}
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
          title={t('appShell.resize')}
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
          restoreClientMission={restoreClientMission}
          restoreAssignment={restoreAssignment}
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
