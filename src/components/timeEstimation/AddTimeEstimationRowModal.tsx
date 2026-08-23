import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClientMission, ClientMissionType, Employee, TimeManualRow } from '../../types/domain';
import { useTimeEstimationHistoryStore } from '../../stores/timeEstimationHistoryStore';
import { withSuppressedRecording } from '../../stores/historyStore';

interface AddTimeEstimationRowModalProps {
  employees: Employee[];
  clientsMissions: ClientMission[];
  // Every (employee, client/mission) pair already rendered as a row today —
  // the duplicate-pair guard below refuses re-adding one of these.
  existingPairKeys: Set<string>;
  findOrCreate: (name: string, type: ClientMissionType) => Promise<ClientMission>;
  createManualRow: (employeeId: string, clientMissionId: string) => Promise<TimeManualRow>;
  deleteManualRow: (id: string) => Promise<void>;
  restoreManualRow: (row: TimeManualRow) => Promise<TimeManualRow>;
  deleteClientMission: (id: string) => Promise<void>;
  restoreClientMission: (row: ClientMission) => Promise<ClientMission>;
  onClose: () => void;
}

// Combines LinkExistingEmployeeModal's search/pick list (simplified — one
// fixed sort, no sortBy selector, since this is embedded in a bigger form
// rather than a standalone modal) with AssignmentEditorModal's exact
// datalist+findOrCreate pattern for the client/mission field. Only creates a
// time_manual_rows marker (see 0029_time_manual_rows.sql) — no assignment,
// no time data — the row then starts empty and every existing cell in the
// grid (N-1 total, monthly cascade, %vendu/%prévu N and N+1) already works
// on it unmodified.
export function AddTimeEstimationRowModal({
  employees,
  clientsMissions,
  existingPairKeys,
  findOrCreate,
  createManualRow,
  deleteManualRow,
  restoreManualRow,
  deleteClientMission,
  restoreClientMission,
  onClose,
}: AddTimeEstimationRowModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [cmName, setCmName] = useState('');
  const [cmType, setCmType] = useState<ClientMissionType>('client');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedQuery = query.toLowerCase();
  const filteredEmployees = employees
    .filter((e) => `${e.first_name} ${e.last_name}`.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => a.first_name.localeCompare(b.first_name) || a.last_name.localeCompare(b.last_name));

  function handleNameChange(value: string) {
    setCmName(value);
    const matches = clientsMissions.filter((cm) => cm.name.toLowerCase() === value.trim().toLowerCase());
    if (matches.length === 1) setCmType(matches[0].type);
  }

  async function handleAdd() {
    if (!selectedEmployeeId) return;
    const name = cmName.trim();
    if (!name) return;
    setSubmitting(true);
    setError(null);
    try {
      // Peek at whether findOrCreate is about to insert a new ClientMission
      // (same check it does internally) BEFORE calling it, so undo knows
      // whether it's allowed to delete that client/mission — never a
      // pre-existing one this action didn't create. Mirrors
      // AssignmentEditorModal's own willCreateClientMission check exactly.
      const willCreateClientMission = !clientsMissions.some(
        (cm) => cm.type === cmType && cm.name.toLowerCase() === name.toLowerCase(),
      );

      let cm!: ClientMission;
      // findOrCreate/deleteClientMission/restoreClientMission (from
      // useClientsMissions.ts) all self-push onto the MAIN org-chart
      // useHistoryStore — this screen records its own Command onto
      // useTimeEstimationHistoryStore instead, so every call to them must be
      // wrapped here, same as AssignmentEditorModal's own call site.
      await withSuppressedRecording(async () => {
        cm = await findOrCreate(name, cmType);
      });

      const pairKey = `${selectedEmployeeId}::${cm.id}`;
      if (existingPairKeys.has(pairKey)) {
        setError(t('timeEstimation.addRowModal.duplicateError'));
        // A brand-new client/mission can never already have a row (nothing
        // could reference an id that didn't exist a moment ago), so this
        // guard is only reachable for a pre-existing one — no cleanup of a
        // just-created client/mission is ever needed here.
        setSubmitting(false);
        return;
      }

      const created = await createManualRow(selectedEmployeeId, cm.id);
      useTimeEstimationHistoryStore.getState().push({
        label: t('timeEstimation.history.addManualRow'),
        undo: () =>
          withSuppressedRecording(async () => {
            await deleteManualRow(created.id);
            if (willCreateClientMission) await deleteClientMission(cm.id);
          }),
        redo: () =>
          withSuppressedRecording(async () => {
            // Client/mission first: the manual row references it.
            if (willCreateClientMission) await restoreClientMission(cm);
            await restoreManualRow(created);
          }),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('timeEstimation.addRowModal.title')}</h2>

        {error && <p className="mb-3 rounded bg-red-50 px-2 py-1 text-xs text-red-600">{error}</p>}

        <label className="mb-1 block text-xs text-slate-500">{t('timeEstimation.addRowModal.employeeLabel')}</label>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('timeEstimation.addRowModal.employeeSearchPlaceholder')}
          autoFocus
          className="mb-2 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
        <div className="mb-4 max-h-40 space-y-0.5 overflow-auto rounded border border-slate-100">
          {filteredEmployees.length === 0 && (
            <p className="px-2 py-1 text-sm text-slate-400">{t('timeEstimation.addRowModal.employeeEmpty')}</p>
          )}
          {filteredEmployees.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setSelectedEmployeeId(e.id)}
              className={`block w-full truncate px-2 py-1 text-left text-sm ${
                selectedEmployeeId === e.id ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              {e.first_name} {e.last_name}
            </button>
          ))}
        </div>

        <label className="mb-1 block text-xs text-slate-500">{t('timeEstimation.addRowModal.clientMissionLabel')}</label>
        <input
          type="text"
          list="time-estimation-add-row-clients-missions-suggestions"
          value={cmName}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder={t('timeEstimation.addRowModal.clientMissionPlaceholder')}
          className="mb-4 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
        <datalist id="time-estimation-add-row-clients-missions-suggestions">
          {clientsMissions.map((cm) => (
            <option key={cm.id} value={cm.name} />
          ))}
        </datalist>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
            {t('timeEstimation.addRowModal.close')}
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={submitting || !selectedEmployeeId || !cmName.trim()}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {t('timeEstimation.addRowModal.add')}
          </button>
        </div>
      </div>
    </div>
  );
}
