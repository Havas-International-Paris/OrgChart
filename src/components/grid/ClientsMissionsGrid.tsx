import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { PermissionDeniedError } from '../../lib/mutationGuard';
import { useUiPreferencesStore } from '../../stores/uiPreferencesStore';
import { EditableCell } from './EditableCell';
import { useEditableRows } from './useEditableRows';
import { compareValues, densityClasses, effectiveForSort, type FieldKind } from './editableGridLogic';
import type { ClientMission } from '../../types/domain';

const FIELDS = ['name'] as const;
type Field = (typeof FIELDS)[number];
const FIELD_KIND: Record<Field, FieldKind> = { name: 'text' };

function emptyDraft(): ClientMission {
  return {
    id: `draft-${crypto.randomUUID()}`,
    name: '',
    // Kept in the data model (the DB column is NOT NULL) but no longer
    // exposed anywhere in the UI — every entry created through the grid is
    // implicitly 'client'-typed now.
    type: 'client',
    created_at: new Date().toISOString(),
  };
}

// Catalog-view-only editor now — Name plus add/delete, same shape as
// JobTitlesGrid/DepartmentsGrid/CompaniesGrid. The old employees/total-ETP
// columns were dropped: they duplicated the Allocations tab, which is the
// main view's own dedicated place to see/edit who's staffed on a client.
export function ClientsMissionsGrid() {
  const { t } = useTranslation();
  const gridDensity = useUiPreferencesStore((s) => s.gridDensity);
  const { clientsMissions, loading, error, createClientMission, updateClientMission, deleteClientMission } =
    useClientsMissions();
  const [actionError, setActionError] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const editing = useEditableRows<ClientMission, Field>({
    fields: FIELDS,
    fieldKind: FIELD_KIND,
    requiredFields: ['name'],
    createRow: useCallback(
      (draft: ClientMission) => createClientMission(draft.name, draft.type),
      [createClientMission],
    ),
    updateField: useCallback(
      async (row: ClientMission, _field: Field, value: string | null) => {
        await updateClientMission(row.id, { name: value ?? '' }, { name: row.name });
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

  const sorted = useMemo(() => {
    const rows = [...clientsMissions].sort((a, b) => {
      const cmp = compareValues(
        effectiveForSort(a, editing.frozenRow).name,
        effectiveForSort(b, editing.frozenRow).name,
      );
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [clientsMissions, sortDir, editing.frozenRow]);

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
              <th className={`${rowPad} px-2 font-medium`}>
                <button
                  type="button"
                  onClick={() => setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))}
                  className="flex items-center gap-1 hover:text-slate-800"
                >
                  {t('grid.clientsMissions.fields.name')}
                  <span className="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>
                </button>
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr role="row">
                <td colSpan={2} className="p-4 text-center text-slate-400">
                  {t('grid.clientsMissions.loading')}
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr role="row">
                <td colSpan={2} className="p-4 text-center text-slate-400">
                  {t('grid.clientsMissions.empty')}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} role="row" className="border-b border-slate-100 hover:bg-slate-50">
                <td role="gridcell" className={`${rowPad} px-2`}>
                  <EditableCell editing={editing} row={row} field="name" title={t('grid.clientsMissions.editName')} />
                </td>
                <td role="gridcell" className={`${rowPad} px-2`}>
                  {row.id !== editing.draft?.id && (
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
