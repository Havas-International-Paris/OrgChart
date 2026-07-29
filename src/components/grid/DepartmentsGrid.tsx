import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDepartments } from '../../hooks/useDepartments';
import { departmentColorMap } from '../../lib/departmentColor';
import { useUiPreferencesStore } from '../../stores/uiPreferencesStore';
import { EditableCell } from './EditableCell';
import { useEditableRows } from './useEditableRows';
import { compareValues, densityClasses, effectiveForSort, type FieldKind } from './editableGridLogic';
import type { Department } from '../../types/domain';

const FIELDS = ['name'] as const;
type Field = (typeof FIELDS)[number];
const FIELD_KIND: Record<Field, FieldKind> = { name: 'text' };

function emptyDraft(): Department {
  return { id: `draft-${crypto.randomUUID()}`, name: '', color: null, created_at: new Date().toISOString() };
}

// A hidden native color input behind the visible dot, opened by clicking the
// dot (the <label> wrapping it). Deliberately binds a native `change`
// listener via a ref rather than React's onChange prop — React normalizes
// onChange to the native `input` event for a color field, which fires
// continuously while the user drags inside the picker, not just once on
// commit; that would push an undo/redo entry (and a Supabase write) per
// drag frame instead of once when the picker closes.
function ColorSwatch({ color, title, onCommit }: { color: string; title: string; onCommit: (color: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handleChange = () => onCommitRef.current(el.value);
    el.addEventListener('change', handleChange);
    return () => el.removeEventListener('change', handleChange);
  }, []);

  return (
    <label
      className="relative block h-3 w-3 cursor-pointer rounded-full"
      style={{ backgroundColor: color }}
      title={title}
    >
      {/* key={color} forces a remount (and a fresh defaultValue) whenever the
          stored color changes elsewhere — e.g. a realtime update from
          another user — since a native color input otherwise never re-reads
          its initial value after mount.
          A genuinely zero-size (h-0 w-0) input never opens the native picker
          on click in Chrome — it silently no-ops. 1x1px + overflow-hidden is
          the standard visually-hidden-but-still-interactive sizing instead. */}
      <input
        key={color}
        ref={inputRef}
        type="color"
        defaultValue={color}
        className="absolute h-px w-px overflow-hidden opacity-0"
      />
    </label>
  );
}

export function DepartmentsGrid() {
  const { departments, loading, error, createDepartment, updateDepartment, updateDepartmentColor, deleteDepartment } =
    useDepartments();
  const gridDensity = useUiPreferencesStore((s) => s.gridDensity);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const editing = useEditableRows<Department, Field>({
    fields: FIELDS,
    fieldKind: FIELD_KIND,
    requiredFields: FIELDS,
    createRow: useCallback((draft: Department) => createDepartment(draft.name), [createDepartment]),
    updateField: useCallback(
      async (row: Department, _field: Field, value: string | null) => {
        await updateDepartment(row.id, value ?? '', row.name);
      },
      [updateDepartment],
    ),
  });

  // Colours are assigned by position in the sorted catalog (departmentColor.ts),
  // so a still-local draft is deliberately not part of the map — it gets its
  // colour the moment it becomes a real row.
  const colorByName = useMemo(() => departmentColorMap(departments), [departments]);

  const handleDelete = useCallback(
    (id: string) => {
      setActionError(null);
      deleteDepartment(id).catch((err) => setActionError(err instanceof Error ? err.message : String(err)));
    },
    [deleteDepartment],
  );

  const sorted = useMemo(() => {
    const rows = [...departments].sort((a, b) => {
      const cmp = compareValues(
        effectiveForSort(a, editing.frozenRow).name,
        effectiveForSort(b, editing.frozenRow).name,
      );
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [departments, sortDir, editing.frozenRow]);

  const { rowPad, cellText } = densityClasses(gridDensity);
  const rows = editing.draft ? [editing.draft, ...sorted] : sorted;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Business Units</h2>
        <button
          onClick={() => editing.startDraft(emptyDraft())}
          disabled={Boolean(editing.draft)}
          className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          + Ajouter
        </button>
      </div>
      {(error || actionError) && <p className="text-sm text-red-600">{error ?? actionError}</p>}
      <div className="min-h-0 flex-1 overflow-auto">
        <table role="grid" className={`w-full border-collapse ${cellText}`}>
          <thead>
            <tr role="row" className="border-b border-slate-200 text-left text-slate-500">
              <th className="w-14 px-2 font-medium">Couleur</th>
              <th className={`${rowPad} px-2 font-medium`}>
                <button
                  type="button"
                  onClick={() => setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))}
                  className="flex items-center gap-1 hover:text-slate-800"
                >
                  Business Unit
                  <span className="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>
                </button>
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr role="row">
                <td colSpan={3} className="p-4 text-center text-slate-400">
                  Chargement…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr role="row">
                <td colSpan={3} className="p-4 text-center text-slate-400">
                  Aucune Business Unit.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const color = colorByName.get(row.name);
              const isDraftRow = row.id === editing.draft?.id;
              return (
                <tr key={row.id} role="row" className="border-b border-slate-100 hover:bg-slate-50">
                  <td role="gridcell" className={`${rowPad} px-2`}>
                    {color &&
                      (isDraftRow ? (
                        <span className="block h-3 w-3 rounded-full" style={{ backgroundColor: color }} title={color} />
                      ) : (
                        <ColorSwatch
                          color={color}
                          title={`Changer la couleur de ${row.name}`}
                          onCommit={(newColor) => updateDepartmentColor(row.id, newColor)}
                        />
                      ))}
                  </td>
                  <td role="gridcell" className={`${rowPad} px-2`}>
                    <EditableCell editing={editing} row={row} field="name" title="Modifier la Business Unit" />
                  </td>
                  <td role="gridcell" className={`${rowPad} px-2`}>
                    {row.id !== editing.draft?.id && (
                      <button
                        onClick={() => handleDelete(row.id)}
                        title="Supprimer"
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
    </div>
  );
}
