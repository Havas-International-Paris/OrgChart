import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isSupabaseConfigured } from '../../lib/supabaseClient';
import { useAuth } from '../../hooks/useAuth';
import { useCurrentUserRole } from '../../hooks/useCurrentUserRole';
import { useRegistryOrgChart } from '../../hooks/useRegistryOrgChart';
import { useEmployees } from '../../hooks/useEmployees';
import { useAssignments } from '../../hooks/useAssignments';
import { useReportingGraph } from '../../hooks/useReportingGraph';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { useOrgCharts } from '../../hooks/useOrgCharts';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUiPreferencesStore } from '../../stores/uiPreferencesStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useTimeEstimationHistoryStore } from '../../stores/timeEstimationHistoryStore';
import { buildChatCommand } from '../../lib/chatUndo';
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
import { AccountMenu } from '../shared/AccountMenu';
import { AccessManagementScreen } from '../access/AccessManagementScreen';
import { TimeEstimationScreen } from '../timeEstimation/TimeEstimationScreen';
import { ChatToggleButton } from '../chat/ChatToggleButton';
import { ChatPanel } from '../chat/ChatPanel';

function LoadingScreen({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center text-slate-500">{label}</div>;
}

// Purely visual affordance for the grid/chart and chart/chat dividers —
// design-critique feedback: the draggable divider gave no visual hint it was
// interactive besides the cursor changing on hover, which a first-time user
// has no reason to discover. Three dots, invisible until the divider itself
// is hovered (`group-hover`), centered on it — doesn't change the actual
// hit-area/drag behavior, purely a hover-revealed hint.
function DividerGrip() {
  return (
    <div className="pointer-events-none absolute inset-y-0 left-1/2 flex -translate-x-1/2 flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
      <span className="h-1 w-1 rounded-full bg-slate-500" />
      <span className="h-1 w-1 rounded-full bg-slate-500" />
      <span className="h-1 w-1 rounded-full bg-slate-500" />
    </div>
  );
}

// Matches Tailwind's default `lg` breakpoint, used below to switch between
// the desktop side-by-side split and the mobile stacked-tabs layout. Driven
// by matchMedia rather than pure CSS (hidden/lg:flex) on purpose: OrgChartView
// owns realtime subscriptions, elk layout computation and drag state — CSS-
// only hiding still mounts it, so a naive hidden/lg:flex + lg:hidden pair
// would mount it TWICE simultaneously near the breakpoint (once per branch),
// double-subscribing and double-computing for no benefit. Gating which
// branch even mounts in React, not just which one is visible, avoids that.
const LG_BREAKPOINT_PX = 1024;

function useIsDesktopViewport(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= LG_BREAKPOINT_PX);
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT_PX}px)`);
    const handleChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);
  return isDesktop;
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

  return (
    <AuthenticatedApp
      key={session.user.id}
      signOut={signOut}
      accessToken={session.access_token}
      email={session.user.email}
      userId={session.user.id}
    />
  );
}

function AuthenticatedApp({
  signOut,
  accessToken,
  email,
  userId,
}: {
  signOut: () => void;
  accessToken: string;
  email: string | undefined;
  userId: string;
}) {
  const { t } = useTranslation();
  const { role, status: roleStatus } = useCurrentUserRole(userId);
  const [showAccessManagement, setShowAccessManagement] = useState(false);
  const [showTimeEstimation, setShowTimeEstimation] = useState(false);
  const { registryOrgChart } = useRegistryOrgChart();
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
  // Disabled while Time Estimation is showing — that screen has its own
  // fully independent history/shortcut (useTimeEstimationUndoRedoShortcuts,
  // mounted from TimeEstimationScreen.tsx itself), so Cmd+Z on either screen
  // can never act on the other's edits. Called unconditionally here (this
  // is a hook, before the showTimeEstimation early return below), so
  // `enabled` — not simply not calling it — is what gates the listener.
  useUndoRedoShortcuts(!showTimeEstimation);
  const { employees, deleteEmployee, restoreEmployee, updateEmployee } = useEmployees(currentOrgChartId);
  const {
    assignmentsOf,
    createAssignment,
    restoreAssignment,
    updateAssignmentEtpVendu,
    updateAssignmentEtpReel,
    updateAssignmentRemuneration,
    deleteAssignment,
  } = useAssignments(currentOrgChartId);
  // Instantiated here purely for its mutators (item 48) — EmployeeGrid and
  // OrgChartView already have their own separate instances for the grid/
  // chart UI itself; a third simultaneous instance is the established,
  // documented pattern for this hook (each subscribes with its own realtime
  // channel UUID), not a new one invented for chat.
  const { addRelationship, restoreRelationship, removeRelationship, reassignManager } =
    useReportingGraph(currentOrgChartId);
  const { clientsMissions, findOrCreate, restoreClientMission, deleteClientMission } = useClientsMissions();
  // Backlog item 48 — translates a chat write tool's result into a real
  // historyStore Command using the same hook mutators the grid/chart use,
  // so it's undoable through the header's own Undo button. See
  // src/lib/chatUndo.ts for the per-tool mapping and why this can't be
  // built any other way (a Command's undo/redo must be closures over these
  // exact mutators, not raw services/*.ts calls).
  const handleChatWriteToolResult = (name: string, args: Record<string, unknown>, output: unknown) => {
    if (!currentOrgChartId) return;
    const command = buildChatCommand(
      name,
      args,
      output,
      {
        deleteEmployee,
        restoreEmployee,
        updateEmployee,
        addRelationship,
        restoreRelationship,
        removeRelationship,
        reassignManager,
        restoreAssignment,
        deleteAssignment,
        updateAssignmentEtpVendu,
        updateAssignmentEtpReel,
        updateAssignmentRemuneration,
      },
      currentOrgChartId,
      t,
    );
    if (command) useHistoryStore.getState().push(command);
  };
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
  // Whether the panel shows is ephemeral (like filtersOpen above); only its
  // width (chatWidthFraction) is a persisted preference.
  const [chatOpen, setChatOpen] = useState(false);
  // Below the `lg` breakpoint (see the mobile-only block further down), the
  // grid/chart side-by-side split is replaced by two stacked tabs instead —
  // design-critique finding: the split has no responsive behavior at all, so
  // under ~1024px both panels get squeezed into unreadable slivers rather
  // than adapting. Purely local/ephemeral (like filtersOpen above): which
  // mobile tab is showing isn't worth persisting across reloads or chart
  // switches, unlike splitFraction/chatWidthFraction which describe the
  // desktop layout the user actually tuned.
  const [mobileTab, setMobileTab] = useState<'grid' | 'chart'>('grid');
  const isDesktop = useIsDesktopViewport();
  const chatWidthFraction = useUiPreferencesStore((s) => s.chatWidthFraction);
  const setChatWidthFraction = useUiPreferencesStore((s) => s.setChatWidthFraction);

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

  function handleChatDividerPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.buttons !== 1 || !splitContainerRef.current) return;
    const rect = splitContainerRef.current.getBoundingClientRect();
    // Dragged from the panel's own left edge, so its width is measured from
    // the container's right side inward, not from the left like splitFraction.
    const fraction = (rect.right - e.clientX) / rect.width;
    setChatWidthFraction(Math.min(0.5, Math.max(0.2, fraction)));
  }

  useEffect(() => {
    if (!currentOrgChartId && orgCharts.length > 0) {
      switchOrgChart(orgCharts[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrgChartId, orgCharts]);

  // Reachable regardless of chart-loading state (an admin should be able to
  // approve accounts even before any chart has loaded) — checked ahead of
  // every other early return below.
  if (showAccessManagement) {
    return (
      <div className="flex h-full flex-col">
        <AccessManagementScreen onBack={() => setShowAccessManagement(false)} />
      </div>
    );
  }

  if (showTimeEstimation) {
    return (
      <div className="flex h-full flex-col">
        <TimeEstimationScreen
          onBack={() => {
            // Leaving Time Estimation — its own independent history is
            // reset to empty here, not on re-entry, so it can never be
            // triggered from outside its own screen either way.
            useTimeEstimationHistoryStore.getState().reset();
            setShowTimeEstimation(false);
          }}
        />
      </div>
    );
  }

  // Each waiting state says which one it is. They all used to read "Chargement…",
  // which made the hang above genuinely hard to place: the page gave no way to
  // tell "still checking the session" from "session fine, no chart to open".
  if (orgChartsLoading) {
    return <LoadingScreen label={t('appShell.loadingOrgCharts')} />;
  }

  // A signed-in user with no chart at all would otherwise sit on a spinner
  // forever, since nothing can be selected. Reachable by deleting the last
  // chart, and previously indistinguishable from a network stall — now ALSO
  // reachable by a brand-new signup, since 0015_user_roles.sql's RLS makes
  // org_charts return zero rows for a pending account (not an error, so this
  // is the only place that state is visible). Backlog item 53's spec asks
  // for this to read differently from the generic "no chart at all" case.
  if (orgCharts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
        {roleStatus === 'pending' ? (
          <p>{t('access.awaitingApproval')}</p>
        ) : (
          <>
            <p>{t('appShell.noOrgChartsTitle')}</p>
            <p className="text-slate-400">{t('appShell.noOrgChartsSubtitle')}</p>
          </>
        )}
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
      {/* items-start (not items-center): the left cluster wraps internally
          on its own (flex-wrap below) when it doesn't fit, growing the
          header downward — the right cluster (Ask AI/Account) must NOT
          follow it into that wrap. Two separate flex children, neither
          flex-wrap-ing against the other, is what keeps Ask AI/Account
          pinned to the header's top-right corner regardless of how much the
          left side wraps — design-critique/user finding: previously both
          clusters lived in one shared flex-wrap div, so when it wrapped
          Ask AI/Account rode along onto a left-aligned second line instead
          of staying at the right edge. */}
      <header className="flex items-start justify-between gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <h1 className="text-sm font-semibold text-slate-900">{t('appShell.title')}</h1>
          <select
            value={currentOrgChartId}
            onChange={(e) => switchOrgChart(e.target.value)}
            title={orgCharts.find((c) => c.id === currentOrgChartId)?.name ?? registryOrgChart?.name}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700"
          >
            {orgCharts.map((chart) => (
              <option key={chart.id} value={chart.id} title={chart.name}>
                {chart.short_label ? `${chart.name} – ${chart.short_label}` : chart.name}
              </option>
            ))}
            {/* orgCharts (from useOrgCharts) deliberately excludes the
                registry chart — see orgChartService.fetchOrgCharts. Without
                this, the <select> would show nothing selected while the
                registry is the active chart (reached via AccountMenu's
                admin-only entry below). Switching away just means picking a
                normal chart from the list above, as usual. */}
            {registryOrgChart && currentOrgChartId === registryOrgChart.id && (
              <option key={registryOrgChart.id} value={registryOrgChart.id} title={registryOrgChart.name}>
                {registryOrgChart.name}
              </option>
            )}
          </select>
          {/* Same outline treatment as FiltersToggle's inactive state —
              design-critique finding: Manage/Sign out were bare unstyled
              text while their neighbors (Filters, Ask AI) were bordered
              buttons, so the header read as 4 unrelated button styles
              instead of one system with a single primary action (Ask AI,
              dark when open) and everything else secondary/outline. */}
          <button
            onClick={() => setManagingCharts(true)}
            className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            {t('appShell.manage')}
          </button>
          {/* Divider: separates "which chart, and its admin" (selector +
              Manage) from the tools that work within the currently open
              chart (search/filter/undo-redo) — design-critique finding that
              the header read as one undifferentiated row with no way to
              scan it in logical groups. */}
          <div className="h-5 w-px shrink-0 bg-slate-200" />
          <SearchBar />
          <FiltersToggle open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} />
          {/* Undo/redo applies globally (one shared historyStore) to both
              the grid and the chart — a single instance here, not one
              duplicated in each panel, matches that: there is exactly one
              history to show, regardless of which panel the user is
              looking at. */}
          <UndoRedoButtons />
        </div>
        {/* Ask AI + account menu: a standalone, non-wrapping cluster —
            always the header's top-right corner, independent of the left
            cluster's own wrapping above. */}
        <div className="flex shrink-0 items-center gap-3">
          <ChatToggleButton open={chatOpen} onToggle={() => setChatOpen((o) => !o)} />
          {/* Divider, then the account/profile button: EN/FR and Sign out
              used to be two separate top-level controls at the end of the
              row (the previous header-restyle pass had already separated
              Sign out from EN/FR with its own divider to reduce a misclick
              risk) — consolidated into one round account button per a
              follow-up design request, matching the conventional
              "account menu" pattern instead of spreading account-level
              settings across the header. See AccountMenu.tsx. */}
          <div className="h-5 w-px shrink-0 bg-slate-200" />
          <AccountMenu
            email={email}
            onSignOut={signOut}
            role={role}
            onOpenAccessManagement={() => setShowAccessManagement(true)}
            onOpenRegistry={registryOrgChart ? () => switchOrgChart(registryOrgChart.id) : null}
            onOpenTimeEstimation={() => {
              // Leaving the org-chart/grid screen — its own history is
              // reset to empty here (Time Estimation's own is reset
              // symmetrically on its own onBack, above).
              useHistoryStore.getState().reset();
              setShowTimeEstimation(true);
            }}
          />
        </div>
      </header>
      {/* Renders as a full-width row directly below <header>, not a
          floating popover — this is what makes the header's own bottom
          edge move down when "Filtres" is toggled, per the user's request. */}
      {filtersOpen && <FiltersBar orgChartId={currentOrgChartId} />}
      {isDesktop ? (
        // Desktop (lg and up) — the side-by-side resizable split.
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
            className="group relative w-1.5 shrink-0 cursor-col-resize bg-slate-200 hover:bg-slate-300 active:bg-slate-400"
            title={t('appShell.resize')}
          >
            <DividerGrip />
          </div>
          <section className="min-w-0 flex-1 overflow-hidden">
            <ErrorBoundary>
              <OrgChartView />
            </ErrorBoundary>
          </section>
          {chatOpen && (
            <>
              <div
                onPointerDown={handleDividerPointerDown}
                onPointerMove={handleChatDividerPointerMove}
                className="group relative w-1.5 shrink-0 cursor-col-resize bg-slate-200 hover:bg-slate-300 active:bg-slate-400"
                title={t('appShell.resize')}
              >
                <DividerGrip />
              </div>
              <section className="shrink-0 overflow-hidden" style={{ width: `${chatWidthFraction * 100}%` }}>
                <ChatPanel
                  orgChartId={currentOrgChartId}
                  accessToken={accessToken}
                  onClose={() => setChatOpen(false)}
                  onWriteToolResult={handleChatWriteToolResult}
                />
              </section>
            </>
          )}
        </div>
      ) : (
      // Mobile/tablet (below lg) — stacked tabs instead of a side-by-side
      // split, which has no room to be readable at these widths. If the chat
      // is open it takes over this whole area instead of the tabs — no space
      // for a third side-by-side pane down here the way there is on desktop,
      // and ChatPanel already has its own close button to get back to the
      // tabs.
      <div className="flex flex-1 flex-col overflow-hidden">
        {chatOpen ? (
          <ChatPanel
            orgChartId={currentOrgChartId}
            accessToken={accessToken}
            onClose={() => setChatOpen(false)}
            onWriteToolResult={handleChatWriteToolResult}
          />
        ) : (
          <>
            <div className="flex shrink-0 border-b border-slate-200">
              <button
                onClick={() => setMobileTab('grid')}
                className={`flex-1 px-3 py-2 text-sm font-medium ${
                  mobileTab === 'grid' ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500'
                }`}
              >
                {t('appShell.gridTab')}
              </button>
              <button
                onClick={() => setMobileTab('chart')}
                className={`flex-1 px-3 py-2 text-sm font-medium ${
                  mobileTab === 'chart' ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500'
                }`}
              >
                {t('appShell.chartTab')}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {mobileTab === 'grid' ? (
                <section className="h-full overflow-auto p-4">
                  <LeftPanel />
                </section>
              ) : (
                <section className="h-full overflow-hidden">
                  <ErrorBoundary>
                    <OrgChartView />
                  </ErrorBoundary>
                </section>
              )}
            </div>
          </>
        )}
      </div>
      )}
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
          currentUserId={userId}
          currentUserRole={role}
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
