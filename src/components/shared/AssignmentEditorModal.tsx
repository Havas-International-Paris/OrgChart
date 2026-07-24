import { useState } from 'react';
import type {
  Assignment,
  ClientMission,
  ClientMissionType,
  Employee,
  RemunerationModel,
} from '../../types/domain';
import { useHistoryStore, withSuppressedRecording } from '../../stores/historyStore';
import { createIdBox } from '../../lib/history/idBox';
import { registerIdBox } from '../../stores/idRegistryStore';

interface AssignmentEditorModalProps {
  employee: Employee;
  assignments: Assignment[];
  clientsMissions: ClientMission[];
  orgChartId: string;
  findOrCreate: (name: string, type: ClientMissionType) => Promise<ClientMission>;
  createClientMission: (name: string, type: ClientMissionType) => Promise<ClientMission>;
  deleteClientMission: (id: string) => Promise<void>;
  createAssignment: (
    employeeId: string,
    clientMissionId: string,
    etpVendu: number | null,
    etpReel: number | null,
    remunerationModel: RemunerationModel | null,
  ) => Promise<Assignment>;
  updateAssignmentEtpVendu: (id: string, etpVendu: number | null) => Promise<void>;
  updateAssignmentEtpReel: (id: string, etpReel: number | null) => Promise<void>;
  updateAssignmentRemuneration: (
    id: string,
    remunerationModel: RemunerationModel | null,
    clearVendu: boolean,
  ) => Promise<void>;
  deleteAssignment: (id: string) => Promise<void>;
  onClose: () => void;
}

export function AssignmentEditorModal({
  employee,
  assignments,
  clientsMissions,
  orgChartId,
  findOrCreate,
  createClientMission,
  deleteClientMission,
  createAssignment,
  updateAssignmentEtpVendu,
  updateAssignmentEtpReel,
  updateAssignmentRemuneration,
  deleteAssignment,
  onClose,
}: AssignmentEditorModalProps) {
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ClientMissionType>('client');
  const [newEtp, setNewEtp] = useState('');
  const [newReel, setNewReel] = useState('');
  const [newRemuneration, setNewRemuneration] = useState<RemunerationModel | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientMissionById = new Map(clientsMissions.map((cm) => [cm.id, cm]));
  const venduKnown = assignments.filter((a) => a.etp_vendu !== null);
  const totalVendu = venduKnown.reduce((sum, a) => sum + (a.etp_vendu ?? 0), 0);
  const reelKnown = assignments.filter((a) => a.etp_reel !== null);
  const totalReel = reelKnown.reduce((sum, a) => sum + (a.etp_reel ?? 0), 0);

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
    const rawVendu = newEtp.trim();
    const etpVendu = rawVendu === '' ? null : Number(rawVendu);
    if (etpVendu !== null && (!Number.isFinite(etpVendu) || etpVendu < 0 || etpVendu > 100)) {
      setError('% vendu invalide');
      return;
    }
    const rawReel = newReel.trim();
    const etpReel = rawReel === '' ? null : Number(rawReel);
    if (etpReel !== null && (!Number.isFinite(etpReel) || etpReel < 0 || etpReel > 100)) {
      setError('% réel invalide');
      return;
    }
    const model = newRemuneration === '' ? null : newRemuneration;
    const finalVendu = model === 'commission' ? null : etpVendu;
    setSubmitting(true);
    await runMutation(async () => {
      // Peek at whether findOrCreate is about to insert a new ClientMission
      // (same check it does internally) BEFORE calling it, so undo knows
      // whether it's allowed to delete that client/mission — never a
      // pre-existing one the user didn't create in this same action.
      const willCreateClientMission = !clientsMissions.some(
        (cm) => cm.type === newType && cm.name.toLowerCase() === name.toLowerCase(),
      );
      const cmIdBox = willCreateClientMission ? createIdBox('') : null;
      let cm!: ClientMission;
      let assignmentId!: string;
      await withSuppressedRecording(async () => {
        cm = await findOrCreate(name, newType);
        if (cmIdBox) {
          cmIdBox.id = cm.id;
          registerIdBox(cm.id, cmIdBox);
        }
        const created = await createAssignment(employee.id, cm.id, finalVendu, etpReel, model);
        assignmentId = created.id;
      });
      const assignmentIdBox = createIdBox(assignmentId);
      registerIdBox(assignmentId, assignmentIdBox);

      useHistoryStore.getState().push({
        label: `Ajouter une affectation (${cm.name})`,
        orgChartId,
        undo: () =>
          withSuppressedRecording(async () => {
            await deleteAssignment(assignmentIdBox.id);
            if (cmIdBox) await deleteClientMission(cmIdBox.id);
          }),
        redo: () =>
          withSuppressedRecording(async () => {
            let liveCmId = cm.id;
            if (cmIdBox) {
              const recreatedCm = await createClientMission(cm.name, cm.type);
              cmIdBox.id = recreatedCm.id;
              registerIdBox(recreatedCm.id, cmIdBox);
              liveCmId = recreatedCm.id;
            }
            const recreated = await createAssignment(employee.id, liveCmId, finalVendu, etpReel, model);
            assignmentIdBox.id = recreated.id;
            registerIdBox(recreated.id, assignmentIdBox);
          }),
      });

      setNewName('');
      setNewEtp('');
      setNewReel('');
      setNewRemuneration('');
    });
    setSubmitting(false);
  }

  return (
    <div data-row-stabilizer-ignore className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-lg">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">
          Clients / missions de {employee.first_name} {employee.last_name}
        </h2>
        <p className="text-xs text-slate-500">
          Total vendu : {venduKnown.length > 0 ? `${totalVendu}%` : '—'} ETP
        </p>
        <p className="mb-3 text-xs text-slate-400">
          Total réel : {reelKnown.length > 0 ? `${totalReel}%` : '—'} ETP
        </p>

        {error && (
          <p className="mb-3 rounded bg-red-50 px-2 py-1 text-xs text-red-600">{error}</p>
        )}

        <div className="mb-4 max-h-64 space-y-1 overflow-auto">
          {assignments.length === 0 && (
            <p className="text-sm text-slate-400">Aucune affectation pour le moment.</p>
          )}
          {assignments.map((a) => {
            const cm = clientMissionById.get(a.client_mission_id);
            const isCommission = a.remuneration_model === 'commission';
            return (
              <div key={a.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-slate-50">
                <span className="flex-1 truncate text-sm text-slate-700">
                  {cm?.name ?? '?'}{' '}
                  <span className="text-xs text-slate-400">
                    ({cm?.type === 'mission' ? 'mission' : 'client'})
                  </span>
                </span>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] text-slate-400">modèle</span>
                  <select
                    value={a.remuneration_model ?? ''}
                    onChange={(e) => {
                      const value = e.target.value as RemunerationModel | '';
                      const model = value === '' ? null : value;
                      runMutation(() =>
                        updateAssignmentRemuneration(a.id, model, model === 'commission' && a.etp_vendu !== null),
                      );
                    }}
                    className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                  >
                    <option value="">—</option>
                    <option value="retainer">Retainer</option>
                    <option value="commission">Commission</option>
                  </select>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] text-slate-400">vendu</span>
                  <div className="flex items-center gap-0.5">
                    <input
                      key={`${a.id}-${a.etp_vendu}-${a.remuneration_model}`}
                      type="number"
                      min={0}
                      max={100}
                      placeholder="—"
                      disabled={isCommission}
                      defaultValue={a.etp_vendu ?? ''}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === '') {
                          if (a.etp_vendu !== null) runMutation(() => updateAssignmentEtpVendu(a.id, null));
                          return;
                        }
                        const value = Number(raw);
                        if (Number.isFinite(value) && value >= 0 && value !== a.etp_vendu) {
                          runMutation(() => updateAssignmentEtpVendu(a.id, value));
                        }
                      }}
                      className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-right text-sm disabled:bg-slate-100 disabled:text-slate-300"
                    />
                    <span className="text-xs text-slate-400">%</span>
                  </div>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] text-slate-400">réel</span>
                  <div className="flex items-center gap-0.5">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="—"
                      defaultValue={a.etp_reel ?? ''}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === '') {
                          if (a.etp_reel !== null) runMutation(() => updateAssignmentEtpReel(a.id, null));
                          return;
                        }
                        const value = Number(raw);
                        if (Number.isFinite(value) && value >= 0 && value !== a.etp_reel) {
                          runMutation(() => updateAssignmentEtpReel(a.id, value));
                        }
                      }}
                      className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-right text-sm"
                    />
                    <span className="text-xs text-slate-400">%</span>
                  </div>
                </div>
                <button
                  onClick={() => runMutation(() => deleteAssignment(a.id))}
                  className="text-slate-400 hover:text-red-600"
                  title="Supprimer"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-end gap-2 border-t border-slate-100 pt-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-slate-500">Client ou mission</label>
            <input
              type="text"
              list="clients-missions-suggestions"
              value={newName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Nom…"
              className="h-8 w-full rounded border border-slate-300 px-2 text-sm"
            />
            <datalist id="clients-missions-suggestions">
              {clientsMissions.map((cm) => (
                <option key={cm.id} value={cm.name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Type</label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as ClientMissionType)}
              className="h-8 rounded border border-slate-300 px-2 text-sm"
            >
              <option value="client">Client</option>
              <option value="mission">Mission</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Modèle</label>
            <select
              value={newRemuneration}
              onChange={(e) => {
                const value = e.target.value as RemunerationModel | '';
                setNewRemuneration(value);
                if (value === 'commission') setNewEtp('');
              }}
              className="h-8 rounded border border-slate-300 px-2 text-sm"
            >
              <option value="">—</option>
              <option value="retainer">Retainer</option>
              <option value="commission">Commission</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">% vendu</label>
            <input
              type="number"
              min={0}
              max={100}
              placeholder="—"
              disabled={newRemuneration === 'commission'}
              value={newEtp}
              onChange={(e) => setNewEtp(e.target.value)}
              className="h-8 w-20 rounded border border-slate-300 px-2 text-sm disabled:bg-slate-100 disabled:text-slate-300"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">% réel</label>
            <input
              type="number"
              min={0}
              max={100}
              placeholder="—"
              value={newReel}
              onChange={(e) => setNewReel(e.target.value)}
              className="h-8 w-20 rounded border border-slate-300 px-2 text-sm"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={submitting || !newName.trim()}
            className="h-8 rounded bg-slate-900 px-3 text-sm font-medium text-white disabled:opacity-50"
          >
            Ajouter
          </button>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
