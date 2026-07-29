import { useCallback, useMemo, useState } from 'react';
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
import { EditableCell } from './EditableCell';
import { useEditableRows } from './useEditableRows';
import { compareValues, densityClasses, effectiveForSort, type FieldKind } from './editableGridLogic';

const EDITABLE_FIELDS = ['first_name', 'last_name', 'job_title', 'role_desc', 'department'] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

const FIELD_KIND: Record<EditableField, FieldKind> = {
  first_name: 'text',
  last_name: 'text',
  job_title: 'select',
  role_desc: 'text',
  department: 'select',
};

const FIELD_LABEL: Record<EditableField, string> = {
  first_name: 'Prénom',
  last_name: 'Nom',
  job_title: 'Poste',
  role_desc: 'Rôle',
  department: 'Business Unit',
};

// A name is what makes a draft worth persisting — a poste or Business Unit
// alone is not enough to create an employee row.
const REQUIRED_FIELDS = ['first_name', 'last_name'] as const;

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

// Hand-rolled table + cells, replacing AG Grid (backlog item 31). This grid
// went first and the three catalog grids followed; the editing state machine
// they all share now lives in useEditableRows.ts.
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

  const [sortField, setSortField] = useState<EditableField>('last_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const editing = useEditableRows<Employee, EditableField>({
    fields: EDITABLE_FIELDS,
    fieldKind: FIELD_KIND,
    requiredFields: REQUIRED_FIELDS,
    createRow: useCallback(
      (draft: Employee) =>
        createEmployee({
          first_name: draft.first_name,
          last_name: draft.last_name,
          job_title: draft.job_title ?? undefined,
          role_desc: draft.role_desc ?? undefined,
          department: draft.department ?? undefined,
        }),
      [createEmployee],
    ),
    updateField: useCallback(
      async (row: Employee, field: EditableField, value: string | null) => {
        await updateEmployee(
          row.id,
          { [field]: value } as Partial<EmployeeInput>,
          { [field]: row[field] } as Partial<EmployeeInput>,
        );
      },
      [updateEmployee],
    ),
  });

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
      const ea = effectiveForSort(a, editing.frozenRow);
      const eb = effectiveForSort(b, editing.frozenRow);
      const cmp = compareValues(ea[sortField], eb[sortField]);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [employees, matchingEmployeeIds, searchQuery, sortField, sortDir, editing.frozenRow]);

  const handleAddEmployee = useCallback(() => {
    if (!currentOrgChartId || editing.draft) return;
    editing.startDraft(emptyDraft(currentOrgChartId));
  }, [currentOrgChartId, editing]);

  const handleExport = useCallback(() => {
    const csv = buildEmployeesCsv(employees, employeeById, managersOf, assignmentsOf, clientMissionById);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `employes_export_${date}.csv`);
  }, [employees, employeeById, managersOf, assignmentsOf, clientMissionById]);

  const { rowPad, cellText, avatarSize } = densityClasses(gridDensity);

  const rows = editing.draft ? [editing.draft, ...sortedEmployees] : sortedEmployees;

  // Only the Business Unit cell needs a custom closed rendering (its colour
  // dot) and only the two selects need options; everything else is
  // EditableCell's own default.
  function cellFor(row: Employee, field: EditableField) {
    const value = row[field] as string | null;
    const options =
      field === 'job_title'
        ? jobTitles.map((jt) => ({ value: jt.name, label: jt.name }))
        : field === 'department'
          ? departments.map((d) => ({ value: d.name, label: d.name }))
          : undefined;
    const display =
      field === 'department' && value ? (
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: departmentColorByName.get(value) }}
          />
          <span className="truncate">{value}</span>
        </span>
      ) : undefined;

    return (
      <EditableCell
        editing={editing}
        row={row}
        field={field}
        options={options}
        display={display}
        title={`Modifier ${FIELD_LABEL[field].toLowerCase()}`}
      />
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
            disabled={Boolean(editing.draft)}
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
              const isDraftRow = row.id === editing.draft?.id;
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
                      {cellFor(row, field)}
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
