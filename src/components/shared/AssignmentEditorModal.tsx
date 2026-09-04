import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Assignment,
  ClientMission,
  ClientMissionType,
  Employee,
  RemunerationModel,
} from '../../types/domain';
import { useHistoryStore, withSuppressedRecording } from '../../stores/historyStore';

interface AssignmentEditorModalProps {
  employee: Employee;
  assignments: Assignment[];
  clientsMissions: ClientMission[];
  orgChartId: string;
  findOrCreate: (name: string, type: ClientMissionType) => Promise<ClientMission>;
  restoreClientMission: (row: ClientMission) => Promise<ClientMission>;
  deleteClientMission: (id: string) => Promise<void>;
  restoreAssignment: (row: Assignment) => Promise<Assignment>;
  createAssignment: (
    employeeId: string,
    clientMissionId: string,
    etpVendu: number | null,
    etpReel: number | null,
    remunerationModel: RemunerationModel | null,
  ) => Promise<Assignment>;
  // Not exposed via any UI control in this modal anymore (no per-row ✕) —
  // kept as a prop purely because handleAdd's own undo body needs it to
  // delete the assignment it just created. All %ETP/model editing moved to
  // Time Estimation (see CLAUDE.md's gauge-redesign note); this modal only
  // links/unlinks-via-undo a client/mission, never edits ETP.
  deleteAssignment: (id: string) => Promise<void>;
  onClose: () => void;
}

export function AssignmentEditorModal({
  employee,
  assignments,
  clientsMissions,
  orgChartId,
  findOrCreate,
  restoreClientMission,
  restoreAssignment,
  deleteClientMission,
  createAssignment,
  deleteAssignment,
  onClose,
}: AssignmentEditorModalProps) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ClientMissionType>('client');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientMissionById = new Map(clientsMissions.map((cm) => [cm.id, cm]));
  const venduKnown = assignments.filter((a) => a.etp_vendu !== null);
  const totalVendu = venduKnown.reduce((sum, a) => sum + (a.etp_vendu ?? 0), 0);

  function handleNameChange(value: string) {
    setNewName(value);
    const matches = clientsMissions.filter((cm) => cm.name.toLowerCase() === value.trim().toLowerCase());
    if (matches.length === 1) setNewType(matches[0].type);
  }

  async function runMutation(action: () => Promise<void>) {
    try {
      await action();
      setError(null);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else if (err && typeof err === 'object' && 'message' in err) {
        setError(String((err as { message: unknown }).message));
      } else {
        setError(String(err));
      }
    }
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setSubmitting(true);
    await runMutation(async () => {
      // Peek at whether findOrCreate is about to insert a new ClientMission
      // (same check it does internally) BEFORE calling it, so undo knows
      // whether it's allowed to delete that client/mission — never a
      // pre-existing one the user didn't create in this same action.
      const willCreateClientMission = !clientsMissions.some(
        (cm) => cm.type === newType && cm.name.toLowerCase() === name.toLowerCase(),
      );
      let cm!: ClientMission;
      let createdAssignment!: Assignment;
      await withSuppressedRecording(async () => {
        cm = await findOrCreate(name, newType);
        createdAssignment = await createAssignment(employee.id, cm.id, null, null, null);
      });

      // Both rows are captured and restored under their original ids, so the
      // assignment's client_mission_id still points at the right row after a
      // redo — which is exactly what needed an id indirection before.
      useHistoryStore.getState().push({
        label: t('modals.assignmentEditor.historyAddLabel', { name: cm.name }),
        orgChartId,
        undo: () =>
          withSuppressedRecording(async () => {
            await deleteAssignment(createdAssignment.id);
            if (willCreateClientMission) await deleteClientMission(cm.id);
          }),
        redo: () =>
          withSuppressedRecording(async () => {
            // Client/mission first: the assignment references it.
            if (willCreateClientMission) await restoreClientMission(cm);
            await restoreAssignment(createdAssignment);
          }),
      });

      setNewName('');
    });
    setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-lg">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">
          {t('modals.assignmentEditor.title', { name: `${employee.first_name} ${employee.last_name}` })}
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          {t('modals.assignmentEditor.totalSold', { value: venduKnown.length > 0 ? `${totalVendu}%` : '—' })}
        </p>

        {error && (
          <p className="mb-3 rounded bg-red-50 px-2 py-1 text-xs text-red-600">{error}</p>
        )}

        <div className="mb-4 max-h-64 space-y-1 overflow-auto">
          {assignments.length === 0 && (
            <p className="text-sm text-slate-400">{t('modals.assignmentEditor.empty')}</p>
          )}
          {assignments.map((a) => {
            const cm = clientMissionById.get(a.client_mission_id);
            const modelLabel = a.remuneration_model === 'retainer' ? 'Retainer' : a.remuneration_model === 'commission' ? 'Commission' : null;
            const venduLabel = a.etp_vendu != null ? `${a.etp_vendu}%` : null;
            const detail = [modelLabel, venduLabel].filter(Boolean).join(' · ') || '—';
            return (
              <div key={a.id} className="flex items-center gap-2 rounded px-2 py-1">
                <span className="flex-1 truncate text-sm text-slate-700">{cm?.name ?? '?'}</span>
                <span className="text-xs text-slate-400">{detail}</span>
              </div>
            );
          })}
        </div>

        <div className="flex items-end gap-2 border-t border-slate-100 pt-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-slate-500">{t('modals.assignmentEditor.clientOrMission')}</label>
            <input
              type="text"
              list="clients-missions-suggestions"
              value={newName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder={t('modals.assignmentEditor.namePlaceholder')}
              className="h-8 w-full rounded border border-slate-300 px-2 text-sm"
            />
            <datalist id="clients-missions-suggestions">
              {clientsMissions.map((cm) => (
                <option key={cm.id} value={cm.name} />
              ))}
            </datalist>
          </div>
          <button
            onClick={handleAdd}
            disabled={submitting || !newName.trim()}
            className="h-8 rounded bg-slate-900 px-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {t('modals.assignmentEditor.add')}
          </button>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
          >
            {t('modals.assignmentEditor.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
