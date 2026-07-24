import { useState } from 'react';
import type { Assignment, ClientMission, Employee, RemunerationModel } from '../../types/domain';

interface ClientAssignmentsModalProps {
  clientMission: ClientMission;
  assignments: Assignment[];
  employees: Employee[];
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

function employeeName(employee: Employee | undefined): string {
  return employee ? `${employee.first_name} ${employee.last_name}` : '?';
}

export function ClientAssignmentsModal({
  clientMission,
  assignments,
  employees,
  createAssignment,
  updateAssignmentEtpVendu,
  updateAssignmentEtpReel,
  updateAssignmentRemuneration,
  deleteAssignment,
  onClose,
}: ClientAssignmentsModalProps) {
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [newEtp, setNewEtp] = useState('');
  const [newReel, setNewReel] = useState('');
  const [newRemuneration, setNewRemuneration] = useState<RemunerationModel | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const assignedEmployeeIds = new Set(assignments.map((a) => a.employee_id));
  const availableEmployees = employees.filter((e) => !assignedEmployeeIds.has(e.id));

  const venduKnown = assignments.filter((a) => a.etp_vendu !== null);
  const totalVendu = venduKnown.reduce((sum, a) => sum + (a.etp_vendu ?? 0), 0);
  const reelKnown = assignments.filter((a) => a.etp_reel !== null);
  const totalReel = reelKnown.reduce((sum, a) => sum + (a.etp_reel ?? 0), 0);

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
    const name = newEmployeeName.trim().toLowerCase();
    if (!name) return;
    const match = availableEmployees.find((e) => employeeName(e).toLowerCase() === name);
    if (!match) {
      setError('Employé introuvable (ou déjà assigné à ce client/mission)');
      return;
    }
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
      await createAssignment(match.id, clientMission.id, finalVendu, etpReel, model);
      setNewEmployeeName('');
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
          Employés sur {clientMission.name}{' '}
          <span className="text-xs font-normal text-slate-400">
            ({clientMission.type === 'mission' ? 'mission' : 'client'})
          </span>
        </h2>
        <p className="text-xs text-slate-500">
          Total vendu : {venduKnown.length > 0 ? `${totalVendu}%` : '—'} ETP
        </p>
        <p className="mb-3 text-xs text-slate-400">
          Total réel : {reelKnown.length > 0 ? `${totalReel}%` : '—'} ETP
        </p>

        {error && <p className="mb-3 rounded bg-red-50 px-2 py-1 text-xs text-red-600">{error}</p>}

        <div className="mb-4 max-h-64 space-y-1 overflow-auto">
          {assignments.length === 0 && (
            <p className="text-sm text-slate-400">Aucun employé assigné pour le moment.</p>
          )}
          {assignments.map((a) => {
            const employee = employeeById.get(a.employee_id);
            const isCommission = a.remuneration_model === 'commission';
            return (
              <div key={a.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-slate-50">
                <span className="flex-1 truncate text-sm text-slate-700">{employeeName(employee)}</span>
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
                  title="Retirer"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-end gap-2 border-t border-slate-100 pt-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-slate-500">Employé</label>
            <input
              type="text"
              list="available-employees-suggestions"
              value={newEmployeeName}
              onChange={(e) => setNewEmployeeName(e.target.value)}
              placeholder="Nom…"
              className="h-8 w-full rounded border border-slate-300 px-2 text-sm"
            />
            <datalist id="available-employees-suggestions">
              {availableEmployees.map((e) => (
                <option key={e.id} value={employeeName(e)} />
              ))}
            </datalist>
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
            disabled={submitting || !newEmployeeName.trim()}
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
