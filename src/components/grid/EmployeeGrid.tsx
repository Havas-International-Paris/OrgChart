import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEmployees } from '../../hooks/useEmployees';
import { useReportingGraph } from '../../hooks/useReportingGraph';
import { useAssignments } from '../../hooks/useAssignments';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { useJobTitles } from '../../hooks/useJobTitles';
import { useDepartments } from '../../hooks/useDepartments';
import { usePhotoActions } from '../../hooks/usePhotoActions';
import { useEmployeeDeletion } from '../../hooks/useEmployeeDeletion';
import { UndoRedoButtons } from '../shared/UndoRedoButtons';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUiPreferencesStore } from '../../stores/uiPreferencesStore';
import { ManagerEditorModal } from '../shared/ManagerEditorModal';
import { PhotoAvatar } from '../shared/PhotoAvatar';
import { PhotoEditorModal } from '../shared/PhotoEditorModal';
import { etpStatus } from '../../lib/etpStatus';
import { departmentColorMap, NEUTRAL_DEPARTMENT_COLOR } from '../../lib/departmentColor';
import { buildEmployeesCsv, downloadCsv } from '../../lib/exportEmployeesCsv';
import type { Employee, EmployeeInput } from '../../types/domain';
import {
  EDITABLE_FIELDS,
  FIELD_KIND,
  compareValues,
  draftHasContent,
  effectiveForSort,
  mergeDraftField,
  nextEditableField,
  type EditableField,
} from './editableGridLogic';

const FIELD_LABEL: Record<EditableField, string> = {
  first_name: 'Prénom',
  last_name: 'Nom',
  job_title: 'Poste',
  role_desc: 'Rôle',
  department: 'Business Unit',
};

function emptyDraft(orgChartId: string): Employee {
  const now = new Date().toISOString();
  return {
    id: `draft-${crypto.randomUUID()}`,
    first_name: '',
    last_name: '',
    job_title: null,
    role_desc: null,
    department: null,
    photo_path: null,
    photo_zoom: 1,
    photo_pan_x: 0,
    photo_pan_y: 0,
    sibling_order: null,
    org_chart_id: orgChartId,
    created_at: now,
    updated_at: now,
    created_by: null,
    updated_by: null,
  };
}

interface ActiveCell {
  rowId: string;
  field: EditableField;
}

// Rebuilt on TanStack Table + hand-rolled cells, replacing AG Grid for this one
// grid (backlog item 31). The other 3 grids (Postes, Business Units,
// Clients/Missions) stay on AG Grid + useRowStabilizer.ts for now — see
// CLAUDE.md for why running two grid systems briefly, rather than indefinitely,
// was the deliberate call here.
//
// AG Grid's own machinery caused all three diagnosed symptoms: (a) rows jumping
// mid-edit came from its cell-focus event resolving a row by POST-resort index,
// which can already point at a different employee by the time the event fires;
// (b) the pinned "new row" was a real INSERT before the user typed anything,
// so clicking away left a permanent, blank ghost employee; (c) Tab's default
// cell-to-cell navigation silently entered edit mode on the next column
// (Poste's select), pre-highlighting a default value the user never chose.
// None of the three needed AG Grid's spreadsheet feature set to happen — they
// are specific, fixable mistakes in how this app drove it. Owning the render
// loop removes the whole class: there is no separate row-recycling system to
// keep in sync, no comparator to freeze, no popup-parent scoping to remember.
export function EmployeeGrid() {
  const currentOrgChartId = useSelectionStore((s) => s.currentOrgChartId);
  const gridDensity = useUiPreferencesStore((s) => s.gridDensity);
  const {
    employees,
    loading,
    error,
    createEmployee,
    restoreEmployee,
    updateEmployee,
    deleteEmployee,
    updateEmployeePhoto,
    updateEmployeePhotoFrame,
  } = useEmployees(currentOrgChartId);
  const { replacePhoto, saveFrame, deletePhoto } = usePhotoActions(employees, updateEmployeePhoto, updateEmployeePhotoFrame);
  const [photoEditEmployeeId, setPhotoEditEmployeeId] = useState<string | null>(null);
  const { relationships, managersOf, restoreRelationship, wouldCreateCycle, replaceManagersForEmployee } =
    useReportingGraph(currentOrgChartId);
  const { assignments, assignmentsOf, totalEtpOf, restoreAssignment } = useAssignments(currentOrgChartId);
  const deleteEmployeeWithHistory = useEmployeeDeletion(
    currentOrgChartId,
    { employees, restoreEmployee, deleteEmployee },
    { relationships, restoreRelationship },
    { assignments, restoreAssignment },
  );
  const { clientsMissions } = useClientsMissions();
  const { jobTitles } = useJobTitles();
  const { departments } = useDepartments();
  const [editingManagersFor, setEditingManagersFor] = useState<Employee | null>(null);

  const selectedEmployeeId = useSelectionStore((s) => s.selectedEmployeeId);
  const setSelectedEmployee = useSelectionStore((s) => s.setSelectedEmployee);
  const setAssignmentsEmployeeId = useSelectionStore((s) => s.setAssignmentsEmployeeId);
  const searchQuery = useSelectionStore((s) => s.searchQuery);
  const clientMissionFilterIds = useSelectionStore((s) => s.clientMissionFilterIds);

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const clientMissionById = useMemo(
    () => new Map(clientsMissions.map((cm) => [cm.id, cm])),
    [clientsMissions],
  );
  const departmentColorByName = useMemo(() => departmentColorMap(departments), [departments]);

  // null = filter inactive; otherwise employees with an assignment to at
  // least one selected client/mission (union across the selection).
  const matchingEmployeeIds = useMemo(() => {
    if (clientMissionFilterIds.size === 0) return null;
    const ids = new Set<string>();
    for (const a of assignments) {
      if (clientMissionFilterIds.has(a.client_mission_id)) ids.add(a.employee_id);
    }
    return ids;
  }, [assignments, clientMissionFilterIds]);

  // A row created by "+ Ajouter" that has not been written to Supabase yet —
  // see editableGridLogic.ts's draftHasContent for why. Always rendered pinned
  // above the sorted list, mirroring AG Grid's old pinnedTopRowData but as a
  // plain local value instead of a library feature.
  const [draft, setDraft] = useState<Employee | null>(null);

  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  // Captured the moment a row is FIRST activated for editing (any field), and
  // kept until the user leaves the row entirely — Tab-ing between fields of the
  // same row must not re-take the snapshot. This is what freezes the row's sort
  // position while it's being edited: see effectiveForSort.
  const [frozenRow, setFrozenRow] = useState<{ id: string; snapshot: Employee } | null>(null);
  const [draftValue, setDraftValue] = useState('');
  // Deliberately only ONE place ever commits a field: handleBlur. Keydown
  // handlers never call commitField themselves — they record what should
  // happen once the blur arrives, then force it immediately via `.blur()`.
  // An earlier version had keydown handlers commit directly and set a
  // "suppress the next blur" flag to stop it from double-committing — that
  // broke the moment a blur DIDN'T reliably follow (Tab at the end of a row,
  // where nothing else takes focus): the flag stayed stuck true, so the very
  // next unrelated blur anywhere in the grid was silently swallowed. Found by
  // testing a fresh "+ Ajouter" draft live, right after an unrelated Tab-to-
  // end-of-row edit in the same session — clicking away from the still-blank
  // draft no longer discarded it. Forcing the blur ourselves removes the
  // "did a blur happen or not" question entirely.
  const pendingActionRef = useRef<{ kind: 'cancel' } | { kind: 'move'; next: EditableField } | { kind: 'close' }>({
    kind: 'close',
  });
  const activeInputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  const [sortField, setSortField] = useState<EditableField>('last_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    if (!activeInputRef.current) return;
    activeInputRef.current.focus();
    if (activeInputRef.current instanceof HTMLInputElement) activeInputRef.current.select();
  }, [activeCell]);

  // Takes the row OBJECT, never just an id to look up — on purpose. Every
  // caller either already has a guaranteed-fresh row in hand (the one it's
  // rendering, or the one it just got back from createEmployee/updateEmployee)
  // or would have to fetch one via `employeeById`, which is a snapshot of
  // whatever `employees` was in the render that created THIS closure — after
  // an `await`, that snapshot can be one or more renders behind the row this
  // call is actually about. Taking the row directly removes that lookup
  // entirely, so there's nothing left to go stale.
  const activateCell = useCallback((row: Employee, field: EditableField) => {
    setActiveCell({ rowId: row.id, field });
    setFrozenRow((prev) => (prev?.id === row.id ? prev : { id: row.id, snapshot: row }));
    setDraftValue((row[field] as string | null) ?? '');
  }, []);

  const deactivate = useCallback((discardBlankDraft = false) => {
    setActiveCell(null);
    setFrozenRow(null);
    if (discardBlankDraft) setDraft(null);
  }, []);

  // Takes and returns the row OBJECT, not an id — same reasoning as
  // activateCell above. `row` must be the caller's own fresh copy (the one it
  // is rendering, or one a PREVIOUS commitField call just handed back); this
  // never looks anything up via `employeeById`, so there's no snapshot for an
  // await to leave behind. The returned row is what the caller should treat
  // as current from this point on: unchanged for a plain edit, or the newly
  // created row once a still-local draft gets promoted.
  const commitField = useCallback(
    async (
      row: Employee,
      field: EditableField,
      value: string | null,
    ): Promise<{ row: Employee; isDraftStillBlank: boolean }> => {
      if (draft && row.id === draft.id) {
        const merged = mergeDraftField(draft, field, value);
        if (!draftHasContent(merged)) {
          setDraft(merged);
          return { row: merged, isDraftStillBlank: true };
        }
        const created = await createEmployee({
          first_name: merged.first_name,
          last_name: merged.last_name,
          job_title: merged.job_title ?? undefined,
          role_desc: merged.role_desc ?? undefined,
          department: merged.department ?? undefined,
        });
        setDraft(null);
        return { row: created, isDraftStillBlank: false };
      }
      if (row[field] !== value) {
        await updateEmployee(row.id, { [field]: value } as Partial<EmployeeInput>, { [field]: row[field] } as Partial<EmployeeInput>);
      }
      return { row: { ...row, [field]: value }, isDraftStillBlank: false };
    },
    [draft, createEmployee, updateEmployee],
  );

  const isDraftBlank = useCallback(
    (row: Employee) => Boolean(draft && row.id === draft.id && !draftHasContent(draft)),
    [draft],
  );

  // Keydown only ever records intent + forces the blur that will act on it —
  // see pendingActionRef's own comment for why it never commits directly.
  const handleKeyDown = useCallback((e: React.KeyboardEvent, field: EditableField) => {
    if (e.key === 'Escape') {
      pendingActionRef.current = { kind: 'cancel' };
      (e.target as HTMLElement).blur();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      pendingActionRef.current = { kind: 'close' };
      (e.target as HTMLElement).blur();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      // Tab stops at the end of the row rather than wrapping to the next
      // row's first field — explicit 2026-07-27 decision, no spreadsheet-
      // style keyboard navigation.
      const next = nextEditableField(field);
      pendingActionRef.current = next ? { kind: 'move', next } : { kind: 'close' };
      (e.target as HTMLElement).blur();
    }
  }, []);

  // The single place that ever commits a field or decides a draft's fate.
  // Every keydown path above and every plain click-away funnel through here.
  // Takes `row` (the caller's fresh copy), never an id — see commitField.
  const handleBlur = useCallback(
    async (row: Employee, field: EditableField, currentValue: string | null) => {
      const action = pendingActionRef.current;
      pendingActionRef.current = { kind: 'close' };

      if (action.kind === 'cancel') {
        deactivate(isDraftBlank(row));
        return;
      }

      let effectiveRow = row;
      let isDraftStillBlank = isDraftBlank(row);
      if (FIELD_KIND[field] === 'text') {
        const result = await commitField(row, field, currentValue);
        effectiveRow = result.row;
        isDraftStillBlank = result.isDraftStillBlank;
      }
      if (action.kind === 'move') activateCell(effectiveRow, action.next);
      else deactivate(isDraftStillBlank);
    },
    [commitField, activateCell, deactivate, isDraftBlank],
  );

  // A select commits on its own onChange (there is no separate "typed but
  // uncommitted" state for a dropdown) but deliberately does NOT deactivate —
  // it stays open so Tab can still move on to the next field, matching every
  // other field's behaviour while filling a row.
  const handleSelectChange = useCallback(
    (row: Employee, field: EditableField, value: string) => {
      void commitField(row, field, value || null);
    },
    [commitField],
  );

  const toggleSort = useCallback(
    (field: EditableField) => {
      setSortField(field);
      setSortDir((current) => (sortField === field ? (current === 'asc' ? 'desc' : 'asc') : 'asc'));
    },
    [sortField],
  );

  const sortedEmployees = useMemo(() => {
    const base = matchingEmployeeIds ? employees.filter((e) => matchingEmployeeIds.has(e.id)) : employees;
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? base.filter((e) => `${e.first_name} ${e.last_name}`.toLowerCase().includes(query))
      : base;
    const sorted = [...filtered].sort((a, b) => {
      const ea = effectiveForSort(a, frozenRow);
      const eb = effectiveForSort(b, frozenRow);
      const cmp = compareValues(ea[sortField], eb[sortField]);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [employees, matchingEmployeeIds, searchQuery, sortField, sortDir, frozenRow]);

  const handleAddEmployee = useCallback(() => {
    if (!currentOrgChartId || draft) return;
    const created = emptyDraft(currentOrgChartId);
    setDraft(created);
    activateCell(created, 'first_name');
  }, [currentOrgChartId, draft, activateCell]);

  const handleExport = useCallback(() => {
    const csv = buildEmployeesCsv(employees, employeeById, managersOf, assignmentsOf, clientMissionById);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `employes_export_${date}.csv`);
  }, [employees, employeeById, managersOf, assignmentsOf, clientMissionById]);

  const rowPad = gridDensity === 'compact' ? 'py-1' : 'py-2';
  const cellText = gridDensity === 'compact' ? 'text-xs' : 'text-sm';
  const avatarSize = gridDensity === 'compact' ? 24 : 28;

  const rows = draft ? [draft, ...sortedEmployees] : sortedEmployees;

  function renderCell(row: Employee, field: EditableField) {
    const isActive = activeCell?.rowId === row.id && activeCell.field === field;
    const kind = FIELD_KIND[field];

    if (isActive && kind === 'select') {
      const values = field === 'job_title' ? jobTitles.map((jt) => jt.name) : departments.map((d) => d.name);
      return (
        <select
          ref={(el) => {
            activeInputRef.current = el;
          }}
          value={(row[field] as string | null) ?? ''}
          onChange={(e) => handleSelectChange(row, field, e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, field)}
          onBlur={() => handleBlur(row, field, row[field] as string | null)}
          className="w-full rounded border border-slate-300 bg-white px-1 py-0.5 text-inherit outline-none"
        >
          <option value="">—</option>
          {values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      );
    }

    if (isActive) {
      return (
        <input
          ref={(el) => {
            activeInputRef.current = el;
          }}
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, field)}
          onBlur={() => handleBlur(row, field, draftValue)}
          className="w-full rounded border border-slate-300 bg-white px-1 py-0.5 text-inherit outline-none"
        />
      );
    }

    // Closed display. department gets the colour dot; job_title/role_desc are
    // plain text; first/last name are plain text too but never blank once a
    // row is real (drafts render via their own dedicated placeholder below).
    const value = row[field] as string | null;
    const display =
      field === 'department' ? (
        value ? (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: departmentColorByName.get(value) }} />
            <span className="truncate">{value}</span>
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        )
      ) : (
        <span className="truncate">{value}</span>
      );

    return (
      <button
        type="button"
        onClick={() => activateCell(row, field)}
        className="block w-full truncate text-left"
        title={`Modifier ${FIELD_LABEL[field].toLowerCase()}`}
      >
        {display}
      </button>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Employés</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Exporter CSV
          </button>
          <UndoRedoButtons />
          <button
            onClick={handleAddEmployee}
            disabled={Boolean(draft)}
            className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            + Ajouter
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="min-h-0 flex-1 overflow-auto">
        <table role="grid" className={`w-full border-collapse ${cellText}`}>
          <thead>
            <tr role="row" className="border-b border-slate-200 text-left text-slate-500">
              <th className="w-10" />
              {EDITABLE_FIELDS.map((field) => (
                <th key={field} className={`${rowPad} px-2 font-medium`}>
                  <button
                    type="button"
                    onClick={() => toggleSort(field)}
                    className="flex items-center gap-1 hover:text-slate-800"
                  >
                    {FIELD_LABEL[field]}
                    {sortField === field && <span className="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                  </button>
                </th>
              ))}
              <th className={`${rowPad} px-2 font-medium`}>Managers</th>
              <th className={`${rowPad} px-2 font-medium`}>Clients / Missions</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr role="row">
                <td colSpan={9} className="p-4 text-center text-slate-400">
                  Chargement…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr role="row">
                <td colSpan={9} className="p-4 text-center text-slate-400">
                  Aucun employé.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const isDraftRow = row.id === draft?.id;
              const isSelected = row.id === selectedEmployeeId;
              const managers = managersOf(row.id);
              const managerNames = managers
                .map((m) => {
                  const mgr = employeeById.get(m.manager_id);
                  const label = mgr ? `${mgr.first_name} ${mgr.last_name}` : '?';
                  return m.is_primary ? label : `${label} (secondaire)`;
                })
                .join(', ');
              const count = assignmentsOf(row.id).length;
              const total = totalEtpOf(row.id);
              const status = etpStatus(total);

              return (
                <tr
                  key={row.id}
                  role="row"
                  onClick={() => !isDraftRow && setSelectedEmployee(row.id)}
                  className={`border-b border-slate-100 ${
                    isSelected ? 'bg-slate-100 outline outline-1 outline-slate-900' : 'hover:bg-slate-50'
                  }`}
                >
                  <td role="gridcell" className={`${rowPad} px-2`}>
                    {!isDraftRow && (
                      <PhotoAvatar
                        employeeId={row.id}
                        firstName={row.first_name}
                        lastName={row.last_name}
                        color={departmentColorByName.get(row.department ?? '') ?? NEUTRAL_DEPARTMENT_COLOR}
                        photoPath={row.photo_path}
                        frame={{ zoom: row.photo_zoom, panX: row.photo_pan_x, panY: row.photo_pan_y }}
                        size={avatarSize}
                        onOpen={setPhotoEditEmployeeId}
                      />
                    )}
                  </td>
                  {EDITABLE_FIELDS.map((field) => (
                    <td key={field} role="gridcell" className={`${rowPad} px-2`}>
                      {renderCell(row, field)}
                    </td>
                  ))}
                  <td role="gridcell" className={`${rowPad} px-2`}>
                    {isDraftRow ? null : (
                      <button
                        onClick={() => setEditingManagersFor(row)}
                        className="w-full truncate text-left text-slate-600 hover:underline"
                        title="Modifier les managers"
                      >
                        {managerNames || <span className="text-slate-300">+ Ajouter un manager</span>}
                      </button>
                    )}
                  </td>
                  <td role="gridcell" className={`${rowPad} px-2`}>
                    {isDraftRow ? null : (
                      <button
                        onClick={() => setAssignmentsEmployeeId(row.id)}
                        className={`w-full truncate text-left ${
                          count === 0
                            ? 'text-slate-300'
                            : status === 'green'
                              ? 'text-emerald-700'
                              : status === 'amber'
                                ? 'text-amber-700'
                                : 'text-red-700'
                        }`}
                        title="Modifier les affectations"
                      >
                        {count === 0 ? '+ Ajouter' : `${count} · ${total}% ETP`}
                      </button>
                    )}
                  </td>
                  <td role="gridcell" className={`${rowPad} px-2`}>
                    {isDraftRow ? null : (
                      <button
                        onClick={() => deleteEmployeeWithHistory(row.id)}
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
      {editingManagersFor && (
        <ManagerEditorModal
          employee={editingManagersFor}
          allEmployees={employees}
          currentManagers={managersOf(editingManagersFor.id)}
          wouldCreateCycle={wouldCreateCycle}
          onSave={(desired) => replaceManagersForEmployee(editingManagersFor.id, desired)}
          onClose={() => setEditingManagersFor(null)}
        />
      )}
      {photoEditEmployeeId &&
        (() => {
          const photoEmployee = employeeById.get(photoEditEmployeeId);
          if (!photoEmployee) return null;
          return (
            <PhotoEditorModal
              employeeName={`${photoEmployee.first_name} ${photoEmployee.last_name}`}
              photoPath={photoEmployee.photo_path}
              currentFrame={{
                zoom: photoEmployee.photo_zoom,
                panX: photoEmployee.photo_pan_x,
                panY: photoEmployee.photo_pan_y,
              }}
              onSave={async (file, frame) => {
                if (file) await replacePhoto(photoEmployee.id, file);
                await saveFrame(photoEmployee.id, frame);
              }}
              onDelete={() => deletePhoto(photoEmployee.id)}
              onClose={() => setPhotoEditEmployeeId(null)}
            />
          );
        })()}
    </div>
  );
}
