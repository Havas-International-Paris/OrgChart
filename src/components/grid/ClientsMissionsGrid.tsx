import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { PermissionDeniedError } from '../../lib/mutationGuard';
import { useAssignments } from '../../hooks/useAssignments';
import { useEmployees } from '../../hooks/useEmployees';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUiPreferencesStore } from '../../stores/uiPreferencesStore';
import { etpStatus } from '../../lib/etpStatus';
import { ClientAssignmentsModal } from '../shared/ClientAssignmentsModal';
import { EditableCell } from './EditableCell';
import { useEditableRows } from './useEditableRows';
import { compareValues, densityClasses, effectiveForSort, type FieldKind } from './editableGridLogic';
import type { ClientMission, ClientMissionType } from '../../types/domain';

const FIELDS = ['name', 'type'] as const;
type Field = (typeof FIELDS)[number];
const FIELD_KIND: Record<Field, FieldKind> = { name: 'text', type: 'select' };

function emptyDraft(): ClientMission {
  return {
    id: `draft-${crypto.randomUUID()}`,
    name: '',
    type: 'client',
    created_at: new Date().toISOString(),
  };
}

export function ClientsMissionsGrid() {
  const { t } = useTranslation();
  const TYPE_OPTIONS: { value: ClientMissionType; label: string }[] = useMemo(
    () => [
      { value: 'client', label: t('grid.clientsMissions.type.client') },
      { value: 'mission', label: t('grid.clientsMissions.type.mission') },
    ],
    [t],
  );
  const currentOrgChartId = useSelectionStore((s) => s.currentOrgChartId);
  const gridDensity = useUiPreferencesStore((s) => s.gridDensity);
  const { clientsMissions, loading, error, createClientMission, updateClientMission, deleteClientMission } =
    useClientsMissions();
  const {
    assignmentsOfClientMission,
    totalEtpOfClientMission,
    totalEtpReelOfClientMission,
    createAssignment,
    updateAssignmentEtpVendu,
    updateAssignmentEtpReel,
    updateAssignmentRemuneration,
    deleteAssignment,
  } = useAssignments(currentOrgChartId);
  const { employees } = useEmployees(currentOrgChartId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewingAssignmentsFor, setViewingAssignmentsFor] = useState<ClientMission | null>(null);
  const [sortField, setSortField] = useState<Field>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const editing = useEditableRows<ClientMission, Field>({
    fields: FIELDS,
    fieldKind: FIELD_KIND,
    // Only the name decides whether a draft is real — its type always has a
    // value (the schema's column is NOT NULL, and the draft starts at
    // 'client'), so counting it would promote every empty draft immediately.
    requiredFields: ['name'],
    createRow: useCallback(
      (draft: ClientMission) => createClientMission(draft.name, draft.type),
      [createClientMission],
    ),
    updateField: useCallback(
      async (row: ClientMission, field: Field, value: string | null) => {
        await updateClientMission(row.id, { [field]: value } as Partial<Pick<ClientMission, 'name' | 'type'>>, {
          [field]: row[field],
        } as Partial<Pick<ClientMission, 'name' | 'type'>>);
      },
      [updateClientMission],
    ),
  });

  const handleDelete = useCallback(
    (id: string) => {
      setActionError(null);
      deleteClientMission(id).catch((err) =>
        setActionError(
          err instanceof PermissionDeniedError
            ? t('errors.permissionDenied')
            : t('grid.clientsMissions.deleteInUseError'),
        ),
      );
    },
    [deleteClientMission],
  );

  const toggleSort = useCallback(
    (field: Field) => {
      setSortField(field);
      setSortDir((current) => (sortField === field ? (current === 'asc' ? 'desc' : 'asc') : 'asc'));
    },
    [sortField],
  );

  const sorted = useMemo(() => {
    const rows = [...clientsMissions].sort((a, b) => {
      const cmp = compareValues(
        effectiveForSort(a, editing.frozenRow)[sortField],
        effectiveForSort(b, editing.frozenRow)[sortField],
      );
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [clientsMissions, sortField, sortDir, editing.frozenRow]);

  const { rowPad, cellText } = densityClasses(gridDensity);
  const rows = editing.draft ? [editing.draft, ...sorted] : sorted;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">{t('grid.clientsMissions.title')}</h2>
        <button
          onClick={() => editing.startDraft(emptyDraft())}
          disabled={Boolean(editing.draft)}
          className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {t('grid.clientsMissions.add')}
        </button>
      </div>
      {(error || actionError) && <p className="text-sm text-red-600">{error ?? actionError}</p>}
      <div className="min-h-0 flex-1 overflow-auto">
        <table role="grid" className={`w-full border-collapse ${cellText}`}>
          <thead>
            <tr role="row" className="border-b border-slate-200 text-left text-slate-500">
              {FIELDS.map((field) => (
                <th key={field} className={`${rowPad} px-2 font-medium`}>
                  <button
                    type="button"
                    onClick={() => toggleSort(field)}
                    className="flex items-center gap-1 hover:text-slate-800"
                  >
                    {t(`grid.clientsMissions.fields.${field}`)}
                    {sortField === field && <span className="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                  </button>
                </th>
              ))}
              <th className={`${rowPad} px-2 font-medium`}>{t('grid.clientsMissions.employeesHeader')}</th>
              <th className={`${rowPad} px-2 font-medium`}>{t('grid.clientsMissions.totalActualHeader')}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr role="row">
                <td colSpan={5} className="p-4 text-center text-slate-400">
                  {t('grid.clientsMissions.loading')}
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr role="row">
                <td colSpan={5} className="p-4 text-center text-slate-400">
                  {t('grid.clientsMissions.empty')}
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const isDraftRow = row.id === editing.draft?.id;
              const assignments = assignmentsOfClientMission(row.id);
              const count = assignments.length;
              const totalVendu = totalEtpOfClientMission(row.id);
              const status = etpStatus(totalVendu);
              const knownReel = assignments.filter((a) => a.etp_reel !== null).length;

              return (
                <tr key={row.id} role="row" className="border-b border-slate-100 hover:bg-slate-50">
                  <td role="gridcell" className={`${rowPad} px-2`}>
                    <EditableCell editing={editing} row={row} field="name" title={t('grid.clientsMissions.editName')} />
                  </td>
                  <td role="gridcell" className={`${rowPad} px-2`}>
                    <EditableCell
                      editing={editing}
                      row={row}
                      field="type"
                      options={TYPE_OPTIONS}
                      allowEmpty={false}
                      display={
                        <span className="truncate">
                          {row.type === 'mission' ? t('grid.clientsMissions.type.mission') : t('grid.clientsMissions.type.client')}
                        </span>
                      }
                      title={t('grid.clientsMissions.editType')}
                    />
                  </td>
                  <td role="gridcell" className={`${rowPad} px-2`}>
                    {!isDraftRow && (
                      <button
                        onClick={() => setViewingAssignmentsFor(row)}
                        className={`w-full truncate text-left hover:underline ${
                          count === 0
                            ? 'text-slate-300'
                            : status === 'green'
                              ? 'text-emerald-700'
                              : status === 'amber'
                                ? 'text-amber-700'
                                : 'text-red-700'
                        }`}
                        title={t('grid.clientsMissions.viewDetail')}
                      >
                        {count === 0 ? t('grid.clientsMissions.add2') : `${count} · ${totalVendu}% ${t('grid.clientsMissions.sold')}`}
                      </button>
                    )}
                  </td>
                  <td role="gridcell" className={`${rowPad} px-2 text-slate-400`}>
                    {!isDraftRow && (knownReel > 0 ? `${totalEtpReelOfClientMission(row.id)}%` : '—')}
                  </td>
                  <td role="gridcell" className={`${rowPad} px-2`}>
                    {!isDraftRow && (
                      <button
                        onClick={() => handleDelete(row.id)}
                        title={t('grid.clientsMissions.delete')}
                        className="text-slate-400 hover:text-red-600"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {viewingAssignmentsFor && (
        <ClientAssignmentsModal
          clientMission={viewingAssignmentsFor}
          assignments={assignmentsOfClientMission(viewingAssignmentsFor.id)}
          employees={employees}
          createAssignment={createAssignment}
          updateAssignmentEtpVendu={updateAssignmentEtpVendu}
          updateAssignmentEtpReel={updateAssignmentEtpReel}
          updateAssignmentRemuneration={updateAssignmentRemuneration}
          deleteAssignment={deleteAssignment}
          onClose={() => setViewingAssignmentsFor(null)}
        />
      )}
    </div>
  );
}
