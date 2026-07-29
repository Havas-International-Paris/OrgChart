import { useState } from 'react';
import type { Employee, ReportingRelationship } from '../../types/domain';
import type { DesiredManager } from '../../hooks/useReportingGraph';

interface ManagerEditorModalProps {
  employee: Employee;
  allEmployees: Employee[];
  currentManagers: ReportingRelationship[];
  wouldCreateCycle: (employeeId: string, managerId: string) => boolean;
  onSave: (desired: DesiredManager[]) => Promise<void>;
  onClose: () => void;
}

export function ManagerEditorModal({
  employee,
  allEmployees,
  currentManagers,
  wouldCreateCycle,
  onSave,
  onClose,
}: ManagerEditorModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(currentManagers.map((r) => r.manager_id)),
  );
  const [primaryId, setPrimaryId] = useState<string | null>(
    () => currentManagers.find((r) => r.is_primary)?.manager_id ?? null,
  );
  const [saving, setSaving] = useState(false);

  const candidates = allEmployees.filter((e) => e.id !== employee.id);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (primaryId === id) {
          const remaining = next.values().next().value as string | undefined;
          setPrimaryId(remaining ?? null);
        }
      } else {
        next.add(id);
        if (primaryId === null) setPrimaryId(id);
      }
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    const desired: DesiredManager[] = [...selectedIds].map((managerId) => ({
      managerId,
      isPrimary: managerId === primaryId,
    }));
    try {
      await onSave(desired);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">
          Managers de {employee.first_name} {employee.last_name}
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Cochez un ou plusieurs managers (multi-reporting). Le bouton radio indique le manager
          principal (trait plein dans l'organigramme).
        </p>
        <div className="max-h-72 space-y-1 overflow-auto">
          {candidates.map((candidate) => {
            const checked = selectedIds.has(candidate.id);
            const cyclic = !checked && wouldCreateCycle(employee.id, candidate.id);
            return (
              <label
                key={candidate.id}
                title={cyclic ? 'Créerait une boucle de reporting' : undefined}
                className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${
                  cyclic ? 'cursor-not-allowed text-slate-300' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={cyclic}
                  onChange={() => toggle(candidate.id)}
                />
                <input
                  type="radio"
                  name="primary-manager"
                  checked={primaryId === candidate.id}
                  disabled={!checked}
                  onChange={() => setPrimaryId(candidate.id)}
                />
                <span>
                  {candidate.first_name} {candidate.last_name}
                  {candidate.job_title ? ` — ${candidate.job_title}` : ''}
                </span>
              </label>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}
