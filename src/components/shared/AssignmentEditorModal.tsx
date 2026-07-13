import { useState } from 'react';
import type { Assignment, ClientMission, ClientMissionType, Employee } from '../../types/domain';

interface AssignmentEditorModalProps {
  employee: Employee;
  assignments: Assignment[];
  clientsMissions: ClientMission[];
  findOrCreate: (name: string, type: ClientMissionType) => Promise<ClientMission>;
  createAssignment: (employeeId: string, clientMissionId: string, etpPercent: number) => Promise<void>;
  updateAssignmentEtp: (id: string, etpPercent: number) => Promise<void>;
  deleteAssignment: (id: string) => Promise<void>;
  onClose: () => void;
}

export function AssignmentEditorModal({
  employee,
  assignments,
  clientsMissions,
  findOrCreate,
  createAssignment,
  updateAssignmentEtp,
  deleteAssignment,
  onClose,
}: AssignmentEditorModalProps) {
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ClientMissionType>('client');
  const [newEtp, setNewEtp] = useState('100');
  const [submitting, setSubmitting] = useState(false);

  const clientMissionById = new Map(clientsMissions.map((cm) => [cm.id, cm]));
  const total = assignments.reduce((sum, a) => sum + a.etp_percent, 0);

  async function handleAdd() {
    const name = newName.trim();
    const etp = Number(newEtp);
    if (!name || !Number.isFinite(etp) || etp <= 0) return;
    setSubmitting(true);
    try {
      const cm = await findOrCreate(name, newType);
      await createAssignment(employee.id, cm.id, etp);
      setNewName('');
      setNewEtp('100');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div data-row-stabilizer-ignore className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-lg">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">
          Clients / missions de {employee.first_name} {employee.last_name}
        </h2>
        <p
          className={`mb-3 text-xs ${
            total === 100 ? 'text-emerald-600' : total > 100 ? 'text-red-600' : 'text-amber-600'
          }`}
        >
          Total : {total}% ETP{total !== 100 ? ' — attend 100%' : ''}
        </p>

        <div className="mb-4 max-h-64 space-y-1 overflow-auto">
          {assignments.length === 0 && (
            <p className="text-sm text-slate-400">Aucune affectation pour le moment.</p>
          )}
          {assignments.map((a) => {
            const cm = clientMissionById.get(a.client_mission_id);
            return (
              <div key={a.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-slate-50">
                <span className="flex-1 truncate text-sm text-slate-700">
                  {cm?.name ?? '?'}{' '}
                  <span className="text-xs text-slate-400">
                    ({cm?.type === 'mission' ? 'mission' : 'client'})
                  </span>
                </span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={a.etp_percent}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isFinite(value) && value > 0 && value !== a.etp_percent) {
                      updateAssignmentEtp(a.id, value);
                    }
                  }}
                  className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-right text-sm"
                />
                <span className="text-xs text-slate-400">%</span>
                <button
                  onClick={() => deleteAssignment(a.id)}
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
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nom…"
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
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
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="client">Client</option>
              <option value="mission">Mission</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">% ETP</label>
            <input
              type="number"
              min={1}
              max={100}
              value={newEtp}
              onChange={(e) => setNewEtp(e.target.value)}
              className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={submitting || !newName.trim()}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
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
