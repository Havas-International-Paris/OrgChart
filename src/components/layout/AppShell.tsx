import { isSupabaseConfigured } from '../../lib/supabaseClient';
import { useAuth } from '../../hooks/useAuth';
import { useEmployees } from '../../hooks/useEmployees';
import { useAssignments } from '../../hooks/useAssignments';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { useSelectionStore } from '../../stores/selectionStore';
import { LoginPage } from '../auth/LoginPage';
import { SupabaseSetupNotice } from '../auth/SupabaseSetupNotice';
import { LeftPanel } from './LeftPanel';
import { OrgChartView } from '../chart/OrgChartView';
import { SearchBar } from '../shared/SearchBar';
import { AssignmentEditorModal } from '../shared/AssignmentEditorModal';

export function AppShell() {
  const { session, loading, signOut } = useAuth();
  const { employees } = useEmployees();
  const {
    assignmentsOf,
    createAssignment,
    updateAssignmentEtpVendu,
    updateAssignmentEtpReel,
    updateAssignmentRemuneration,
    deleteAssignment,
  } = useAssignments();
  const { clientsMissions, findOrCreate } = useClientsMissions();
  const assignmentsEmployeeId = useSelectionStore((s) => s.assignmentsEmployeeId);
  const setAssignmentsEmployeeId = useSelectionStore((s) => s.setAssignmentsEmployeeId);

  if (!isSupabaseConfigured) {
    return <SupabaseSetupNotice />;
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-slate-500">Chargement…</div>;
  }

  if (!session) {
    return <LoginPage />;
  }

  const assignmentsEmployee = employees.find((e) => e.id === assignmentsEmployeeId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <h1 className="text-sm font-semibold text-slate-900">Organigramme Havas International</h1>
        <div className="flex items-center gap-3">
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
          <OrgChartView />
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
    </div>
  );
}
