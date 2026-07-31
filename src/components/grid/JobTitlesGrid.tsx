import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useJobTitles } from '../../hooks/useJobTitles';
import { useUiPreferencesStore } from '../../stores/uiPreferencesStore';
import { EditableCell } from './EditableCell';
import { useEditableRows } from './useEditableRows';
import { compareValues, densityClasses, effectiveForSort, type FieldKind } from './editableGridLogic';
import type { JobTitle } from '../../types/domain';

const FIELDS = ['name'] as const;
type Field = (typeof FIELDS)[number];
const FIELD_KIND: Record<Field, FieldKind> = { name: 'text' };

function emptyDraft(): JobTitle {
  return { id: `draft-${crypto.randomUUID()}`, name: '', created_at: new Date().toISOString() };
}

export function JobTitlesGrid() {
  const { t } = useTranslation();
  const { jobTitles, loading, error, createJobTitle, updateJobTitle, deleteJobTitle } = useJobTitles();
  const gridDensity = useUiPreferencesStore((s) => s.gridDensity);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const editing = useEditableRows<JobTitle, Field>({
    fields: FIELDS,
    fieldKind: FIELD_KIND,
    requiredFields: FIELDS,
    createRow: useCallback((draft: JobTitle) => createJobTitle(draft.name), [createJobTitle]),
    updateField: useCallback(
      async (row: JobTitle, _field: Field, value: string | null) => {
        await updateJobTitle(row.id, value ?? '', row.name);
      },
      [updateJobTitle],
    ),
  });

  const handleDelete = useCallback(
    (id: string) => {
      setActionError(null);
      deleteJobTitle(id).catch((err) => setActionError(err instanceof Error ? err.message : String(err)));
    },
    [deleteJobTitle],
  );

  const sorted = useMemo(() => {
    const rows = [...jobTitles].sort((a, b) => {
      const cmp = compareValues(
        effectiveForSort(a, editing.frozenRow).name,
        effectiveForSort(b, editing.frozenRow).name,
      );
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [jobTitles, sortDir, editing.frozenRow]);

  const { rowPad, cellText } = densityClasses(gridDensity);
  const rows = editing.draft ? [editing.draft, ...sorted] : sorted;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">{t('grid.jobTitles.title')}</h2>
        <button
          onClick={() => editing.startDraft(emptyDraft())}
          disabled={Boolean(editing.draft)}
          className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {t('grid.jobTitles.add')}
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
                  {t('grid.jobTitles.nameHeader')}
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
                  {t('grid.jobTitles.loading')}
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr role="row">
                <td colSpan={2} className="p-4 text-center text-slate-400">
                  {t('grid.jobTitles.empty')}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} role="row" className="border-b border-slate-100 hover:bg-slate-50">
                <td role="gridcell" className={`${rowPad} px-2`}>
                  <EditableCell editing={editing} row={row} field="name" title={t('grid.jobTitles.editName')} />
                </td>
                <td role="gridcell" className={`${rowPad} px-2`}>
                  {row.id !== editing.draft?.id && (
                    <button
                      onClick={() => handleDelete(row.id)}
                      title={t('grid.jobTitles.delete')}
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
