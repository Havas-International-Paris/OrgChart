import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(currentManagers.map((r) => r.manager_id)),
  );
  const [primaryId, setPrimaryId] = useState<string | null>(
    () => currentManagers.find((r) => r.is_primary)?.manager_id ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'first_name' | 'last_name' | 'job_title'>('first_name');

  const normalizedQuery = query.toLowerCase();
  const candidates = allEmployees
    .filter((e) => e.id !== employee.id)
    .filter((c) =>
      `${c.first_name} ${c.last_name} ${c.job_title ?? ''}`.toLowerCase().includes(normalizedQuery),
    )
    .sort((a, b) => {
      const aValue = (sortBy === 'job_title' ? a.job_title : a[sortBy]) ?? '';
      const bValue = (sortBy === 'job_title' ? b.job_title : b[sortBy]) ?? '';
      return aValue.localeCompare(bValue);
    });

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
          {t('modals.managerEditor.title', { name: `${employee.first_name} ${employee.last_name}` })}
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          {t('modals.managerEditor.description')}
        </p>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('modals.linkExisting.searchPlaceholder')}
          className="mb-2 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
        <div className="mb-3 flex items-center gap-2">
          <label htmlFor="manager-editor-sort" className="text-xs text-slate-500">
            {t('modals.linkExisting.sortBy')}
          </label>
          <select
            id="manager-editor-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
          >
            <option value="first_name">{t('modals.linkExisting.sortFirstName')}</option>
            <option value="last_name">{t('modals.linkExisting.sortLastName')}</option>
            <option value="job_title">{t('modals.linkExisting.sortJobTitle')}</option>
          </select>
        </div>
        <div className="max-h-72 space-y-1 overflow-auto">
          {candidates.length === 0 && (
            <p className="px-2 py-1 text-sm text-slate-400">{t('modals.linkExisting.empty')}</p>
          )}
          {candidates.map((candidate) => {
            const checked = selectedIds.has(candidate.id);
            const cyclic = !checked && wouldCreateCycle(employee.id, candidate.id);
            return (
              <label
                key={candidate.id}
                title={cyclic ? t('modals.managerEditor.wouldCreateCycle') : undefined}
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
            {t('modals.managerEditor.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? t('modals.managerEditor.saving') : t('modals.managerEditor.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
