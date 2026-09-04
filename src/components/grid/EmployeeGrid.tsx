import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { useCurrentUserRole } from '../../hooks/useCurrentUserRole';
import { useRegistryOrgChart } from '../../hooks/useRegistryOrgChart';
import { useRegistryImport } from '../../hooks/useRegistryImport';
import { useEmployees } from '../../hooks/useEmployees';
import { useReportingGraph } from '../../hooks/useReportingGraph';
import { useAssignments } from '../../hooks/useAssignments';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { useJobTitles } from '../../hooks/useJobTitles';
import { useDepartments } from '../../hooks/useDepartments';
import { useCompanies } from '../../hooks/useCompanies';
import { usePhotoActions } from '../../hooks/usePhotoActions';
import { useEmployeeDeletion } from '../../hooks/useEmployeeDeletion';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUiPreferencesStore } from '../../stores/uiPreferencesStore';
import { ManagerEditorModal } from '../shared/ManagerEditorModal';
import { ImportFromRegistryModal } from '../shared/ImportFromRegistryModal';
import { PhotoAvatar } from '../shared/PhotoAvatar';
import { PhotoEditorModal } from '../shared/PhotoEditorModal';
import { etpStatus } from '../../lib/etpStatus';
import { departmentColorMap, NEUTRAL_DEPARTMENT_COLOR } from '../../lib/departmentColor';
import { companyColorMap } from '../../lib/companyColor';
import { buildEmployeesCsv, downloadCsv } from '../../lib/exportEmployeesCsv';
import type { Employee, EmployeeInput } from '../../types/domain';
import { EditableCell } from './EditableCell';
import { useEditableRows } from './useEditableRows';
import { compareValues, densityClasses, effectiveForSort, type FieldKind } from './editableGridLogic';

const EDITABLE_FIELDS = ['first_name', 'last_name', 'job_title', 'role_desc', 'company', 'department'] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

const FIELD_KIND: Record<EditableField, FieldKind> = {
  first_name: 'text',
  last_name: 'text',
  job_title: 'select',
  role_desc: 'text',
  department: 'select',
  company: 'select',
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
    company: null,
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
    hidden_from_registry_candidates: false,
    has_left_company: false,
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
  const { t } = useTranslation();
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
    updateHasLeftCompany,
  } = useEmployees(currentOrgChartId);
  const hideDepartedEmployees = useUiPreferencesStore((s) => s.hideDepartedEmployees);
  const { replacePhoto, saveFrame, deletePhoto } = usePhotoActions(employees, updateEmployeePhoto, updateEmployeePhotoFrame);
  const [photoEditEmployeeId, setPhotoEditEmployeeId] = useState<string | null>(null);
  const { relationships, managersOf, addRelationship, restoreRelationship, wouldCreateCycle, replaceManagersForEmployee } =
    useReportingGraph(currentOrgChartId);
  const { assignments, assignmentsOf, totalEtpOf, totalEtpReelOf, createAssignment, restoreAssignment } =
    useAssignments(currentOrgChartId);
  const deleteEmployeeWithHistory = useEmployeeDeletion(
    currentOrgChartId,
    { employees, restoreEmployee, deleteEmployee },
    { relationships, restoreRelationship },
    { assignments, restoreAssignment },
  );
  const { clientsMissions } = useClientsMissions();
  const { jobTitles } = useJobTitles();
  const { departments } = useDepartments();
  const { companies } = useCompanies();
  const [editingManagersFor, setEditingManagersFor] = useState<Employee | null>(null);

  // Backlog item 58 — "Ajouter depuis la base centrale" picker. session.user.id
  // isn't otherwise threaded into this component, so it's read directly via
  // useAuth() here rather than prop-drilled from AppShell.
  const { session } = useAuth();
  const { role } = useCurrentUserRole(session?.user.id);
  const { registryOrgChart } = useRegistryOrgChart();
  // The %ETP summary (Prévu/Constaté) only ever means anything on the "base
  // centrale" chart — Time Estimation, the only place etp_vendu can still be
  // edited, operates exclusively on the registry chart's own assignments
  // (see CLAUDE.md's gauge-redesign note), so every other chart's
  // assignments.etp_vendu is permanently null/unset.
  const isRegistryChart = registryOrgChart !== null && currentOrgChartId === registryOrgChart.id;
  const { importFromRegistry } = useRegistryImport(currentOrgChartId, {
    deleteEmployee,
    restoreEmployee,
    addRelationship,
    restoreRelationship,
    createAssignment,
    restoreAssignment,
  });
  const [importingFromRegistry, setImportingFromRegistry] = useState(false);
  const canUseRegistry =
    registryOrgChart !== null &&
    currentOrgChartId !== registryOrgChart.id &&
    (role === 'admin' || role === 'editeur');

  const selectedEmployeeId = useSelectionStore((s) => s.selectedEmployeeId);
  const setSelectedEmployee = useSelectionStore((s) => s.setSelectedEmployee);
  const setDetailPanelEmployeeId = useSelectionStore((s) => s.setDetailPanelEmployeeId);
  const setAssignmentsEmployeeId = useSelectionStore((s) => s.setAssignmentsEmployeeId);
  const searchQuery = useSelectionStore((s) => s.searchQuery);
  const clientMissionFilterIds = useSelectionStore((s) => s.clientMissionFilterIds);
  const deptFilterNames = useSelectionStore((s) => s.deptFilterNames);
  const companyFilterNames = useSelectionStore((s) => s.companyFilterNames);
  const jobTitleFilterNames = useSelectionStore((s) => s.jobTitleFilterNames);
  const etpVenduRange = useSelectionStore((s) => s.etpVenduRange);
  const etpReelRange = useSelectionStore((s) => s.etpReelRange);

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const activeEmployeesForPicking = useMemo(() => employees.filter((e) => !e.has_left_company), [employees]);
  const clientMissionById = useMemo(
    () => new Map(clientsMissions.map((cm) => [cm.id, cm])),
    [clientsMissions],
  );
  const departmentColorByName = useMemo(() => departmentColorMap(departments), [departments]);
  const companyColorByName = useMemo(() => companyColorMap(companies), [companies]);

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
          company: draft.company ?? undefined,
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
    const byDeparture = hideDepartedEmployees ? employees.filter((e) => !e.has_left_company) : employees;
    const byClientMission = matchingEmployeeIds
      ? byDeparture.filter((e) => matchingEmployeeIds.has(e.id))
      : byDeparture;
    const byDept =
      deptFilterNames.size > 0
        ? byClientMission.filter((e) => e.department !== null && deptFilterNames.has(e.department))
        : byClientMission;
    const byCompany =
      companyFilterNames.size > 0
        ? byDept.filter((e) => e.company !== null && companyFilterNames.has(e.company))
        : byDept;
    const byJobTitle =
      jobTitleFilterNames.size > 0
        ? byCompany.filter((e) => e.job_title !== null && jobTitleFilterNames.has(e.job_title))
        : byCompany;
    // Default bounds (0-150) mean "inactive" — same convention as the empty
    // Sets above, kept in sync with selectionStore.ts's own defaults and
    // FiltersPanel.tsx's slider bounds.
    const isVenduRangeActive = etpVenduRange.min > 0 || etpVenduRange.max < 150;
    const byEtpVendu = isVenduRangeActive
      ? byJobTitle.filter((e) => {
          const total = totalEtpOf(e.id);
          return total >= etpVenduRange.min && total <= etpVenduRange.max;
        })
      : byJobTitle;
    const isReelRangeActive = etpReelRange.min > 0 || etpReelRange.max < 150;
    const base = isReelRangeActive
      ? byEtpVendu.filter((e) => {
          const total = totalEtpReelOf(e.id);
          return total >= etpReelRange.min && total <= etpReelRange.max;
        })
      : byEtpVendu;
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
  }, [
    employees,
    hideDepartedEmployees,
    matchingEmployeeIds,
    deptFilterNames,
    companyFilterNames,
    jobTitleFilterNames,
    etpVenduRange,
    etpReelRange,
    totalEtpOf,
    totalEtpReelOf,
    searchQuery,
    sortField,
    sortDir,
    editing.frozenRow,
  ]);

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
          : field === 'company'
            ? companies.map((c) => ({ value: c.name, label: c.name }))
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
      ) : field === 'company' && value ? (
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: companyColorByName.get(value) }}
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
        title={t('grid.employees.editField', { field: t(`grid.employees.fields.${field}`).toLowerCase() })}
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">{t('grid.employees.title')}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {t('grid.employees.exportCsv')}
          </button>
          {canUseRegistry && (
            <button
              onClick={() => setImportingFromRegistry(true)}
              className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {t('grid.employees.addFromRegistry')}
            </button>
          )}
          <button
            onClick={handleAddEmployee}
            disabled={Boolean(editing.draft)}
            className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {t('grid.employees.add')}
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="min-h-0 flex-1 overflow-auto">
        <table role="grid" className={`w-full border-collapse ${cellText}`}>
          <thead>
            <tr role="row" className="border-b border-slate-200 text-left text-slate-500">
              <th className="w-10" />
              <th className="w-10" />
              {EDITABLE_FIELDS.map((field) => (
                <th key={field} className={`${rowPad} px-2 font-medium`}>
                  <button
                    type="button"
                    onClick={() => toggleSort(field)}
                    className="flex items-center gap-1 hover:text-slate-800"
                  >
                    {t(`grid.employees.fields.${field}`)}
                    {sortField === field && <span className="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                  </button>
                </th>
              ))}
              <th className={`${rowPad} px-2 font-medium`}>{t('grid.employees.managersHeader')}</th>
              <th className={`${rowPad} px-2 font-medium`}>{t('grid.employees.clientsMissionsHeader')}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr role="row">
                <td colSpan={11} className="p-4 text-center text-slate-400">
                  {t('grid.employees.loading')}
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr role="row">
                <td colSpan={11} className="p-4 text-center text-slate-400">
                  {t('grid.employees.empty')}
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
                  return m.is_primary ? label : `${label} ${t('grid.employees.secondary')}`;
                })
                .join(', ');
              const count = assignmentsOf(row.id).length;
              const total = totalEtpOf(row.id);
              const status = isRegistryChart ? etpStatus(total) : null;

              return (
                <tr
                  key={row.id}
                  role="row"
                  onClick={() => {
                    if (isDraftRow) return;
                    setSelectedEmployee(row.id);
                    // Unlike a chart card click (which only selects/highlights
                    // until a second click), a grid row click is a deliberate
                    // "find this person" action — keeps opening the chart's
                    // EmployeeDetailPanel immediately, same as before this field
                    // existed.
                    setDetailPanelEmployeeId(row.id);
                  }}
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
                  <td role="gridcell" className={`${rowPad} px-2`}>
                    {isDraftRow ? null : (
                      <button
                        onClick={() => updateHasLeftCompany(row.id, !row.has_left_company)}
                        title={row.has_left_company ? t('grid.employees.markActive') : t('grid.employees.markDeparted')}
                        className={row.has_left_company ? 'text-red-600' : 'text-slate-300 hover:text-slate-500'}
                      >
                        {row.has_left_company ? '⊗' : '○'}
                      </button>
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
                        title={t('grid.employees.editManagers')}
                      >
                        {managerNames || <span className="text-slate-300">{t('grid.employees.addManager')}</span>}
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
                                : status === 'red'
                                  ? 'text-red-700'
                                  : 'text-slate-600'
                        }`}
                        title={t('grid.employees.editAssignments')}
                      >
                        {count === 0 ? t('grid.employees.add2') : isRegistryChart ? `${count} · ${total}% ETP` : count}
                      </button>
                    )}
                  </td>
                  <td role="gridcell" className={`${rowPad} px-2`}>
                    {isDraftRow ? null : (
                      <button
                        onClick={() => deleteEmployeeWithHistory(row.id)}
                        title={t('grid.employees.delete')}
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
          // Hard-excludes departed employees regardless of the "hide
          // departed" toggle — assigning a departed person as a new manager
          // never makes sense, unlike simply seeing them listed elsewhere.
          allEmployees={activeEmployeesForPicking}
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
      {importingFromRegistry && registryOrgChart && (
        <ImportFromRegistryModal
          registryChartId={registryOrgChart.id}
          onImport={(ids, includeAssignments) => importFromRegistry(registryOrgChart.id, ids, includeAssignments)}
          onClose={() => setImportingFromRegistry(false)}
        />
      )}
    </div>
  );
}
