import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  AllCommunityModule,
  themeQuartz,
  type CellValueChangedEvent,
  type ColDef,
  type GridReadyEvent,
  type RowClassParams,
  type RowClickedEvent,
} from 'ag-grid-community';
import { useEmployees } from '../../hooks/useEmployees';
import { useReportingGraph } from '../../hooks/useReportingGraph';
import { useAssignments } from '../../hooks/useAssignments';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { useJobTitles } from '../../hooks/useJobTitles';
import { useDepartments } from '../../hooks/useDepartments';
import { useSelectionStore } from '../../stores/selectionStore';
import { nameColumnDefs, roleDescColumnDef } from './gridColumnDefs';
import { useRowStabilizer } from './useRowStabilizer';
import { ManagerEditorModal } from '../shared/ManagerEditorModal';
import { etpStatus } from '../../lib/etpStatus';
import { departmentColorMap } from '../../lib/departmentColor';
import { buildEmployeesCsv, downloadCsv } from '../../lib/exportEmployeesCsv';
import type { Employee } from '../../types/domain';

ModuleRegistry.registerModules([AllCommunityModule]);

export function EmployeeGrid() {
  const currentOrgChartId = useSelectionStore((s) => s.currentOrgChartId);
  const { employees, loading, error, createEmployee, updateEmployee, deleteEmployee } =
    useEmployees(currentOrgChartId);
  const { managersOf, wouldCreateCycle, replaceManagersForEmployee } = useReportingGraph(currentOrgChartId);
  const { assignmentsOf, totalEtpOf } = useAssignments(currentOrgChartId);
  const { clientsMissions } = useClientsMissions();
  const { jobTitles } = useJobTitles();
  const { departments } = useDepartments();
  const [editingManagersFor, setEditingManagersFor] = useState<Employee | null>(null);

  const selectedEmployeeId = useSelectionStore((s) => s.selectedEmployeeId);
  const setSelectedEmployee = useSelectionStore((s) => s.setSelectedEmployee);
  const setAssignmentsEmployeeId = useSelectionStore((s) => s.setAssignmentsEmployeeId);
  const searchQuery = useSelectionStore((s) => s.searchQuery);

  const {
    gridApiRef,
    containerRef,
    pinnedTopId,
    pinNewRow,
    comparatorFor,
    handleCellEditingStarted,
    handleCellFocused,
  } = useRowStabilizer<Employee>();

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const clientMissionById = useMemo(
    () => new Map(clientsMissions.map((cm) => [cm.id, cm])),
    [clientsMissions],
  );
  const departmentColorByName = useMemo(() => departmentColorMap(departments), [departments]);

  const mainRowData = useMemo(
    () => (pinnedTopId ? employees.filter((e) => e.id !== pinnedTopId) : employees),
    [employees, pinnedTopId],
  );
  const pinnedTopRowData = useMemo(() => {
    if (!pinnedTopId) return undefined;
    const row = employees.find((e) => e.id === pinnedTopId);
    return row ? [row] : undefined;
  }, [employees, pinnedTopId]);

  const handleCellValueChanged = useCallback(
    (event: CellValueChangedEvent<Employee>) => {
      const field = event.colDef.field as keyof Employee | undefined;
      if (!field || !event.data) return;
      updateEmployee(event.data.id, { [field]: event.newValue });
    },
    [updateEmployee],
  );

  const getRowStyle = useCallback(
    (params: RowClassParams<Employee>) =>
      params.data?.id === selectedEmployeeId
        ? { backgroundColor: '#f1f5f9', outline: '1px solid #0f172a' }
        : undefined,
    [selectedEmployeeId],
  );

  useEffect(() => {
    gridApiRef.current?.redrawRows();
    if (selectedEmployeeId) {
      const node = gridApiRef.current?.getRowNode(selectedEmployeeId);
      if (node) gridApiRef.current?.ensureNodeVisible(node, 'middle');
    }
  }, [selectedEmployeeId]);

  const columnDefs = useMemo<ColDef<Employee>[]>(
    () => [
      { ...nameColumnDefs[0], comparator: comparatorFor('first_name') },
      { ...nameColumnDefs[1], comparator: comparatorFor('last_name') },
      {
        field: 'job_title',
        headerName: 'Poste',
        editable: true,
        flex: 1,
        minWidth: 160,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: jobTitles.map((jt) => jt.name) },
        comparator: comparatorFor('job_title'),
      },
      { ...roleDescColumnDef, comparator: comparatorFor('role_desc') },
      {
        field: 'department',
        headerName: 'Business Unit',
        editable: true,
        flex: 1,
        minWidth: 160,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: departments.map((d) => d.name) },
        comparator: comparatorFor('department'),
        cellRenderer: (params: { data: Employee }) => {
          const name = params.data.department;
          if (!name) return <span className="text-slate-300">—</span>;
          return (
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: departmentColorByName.get(name) }}
              />
              <span className="truncate">{name}</span>
            </span>
          );
        },
      },
      {
        headerName: 'Managers',
        flex: 1,
        minWidth: 200,
        sortable: false,
        filter: false,
        cellRenderer: (params: { data: Employee }) => {
          const managers = managersOf(params.data.id);
          const names = managers
            .map((m) => {
              const mgr = employeeById.get(m.manager_id);
              const label = mgr ? `${mgr.first_name} ${mgr.last_name}` : '?';
              return m.is_primary ? label : `${label} (secondaire)`;
            })
            .join(', ');
          return (
            <button
              onClick={() => setEditingManagersFor(params.data)}
              className="w-full truncate text-left text-slate-600 hover:underline"
              title="Modifier les managers"
            >
              {names || <span className="text-slate-300">+ Ajouter un manager</span>}
            </button>
          );
        },
      },
      {
        headerName: 'Clients / Missions',
        flex: 1,
        minWidth: 160,
        sortable: false,
        filter: false,
        cellRenderer: (params: { data: Employee }) => {
          const count = assignmentsOf(params.data.id).length;
          const total = totalEtpOf(params.data.id);
          const status = etpStatus(total);
          return (
            <button
              onClick={() => setAssignmentsEmployeeId(params.data.id)}
              className={`w-full truncate text-left text-sm hover:underline ${
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
          );
        },
      },
      {
        headerName: '',
        width: 56,
        sortable: false,
        filter: false,
        cellRenderer: (params: { data: Employee }) => (
          <button
            onClick={() => deleteEmployee(params.data.id)}
            title="Supprimer"
            className="text-slate-400 hover:text-red-600"
          >
            ✕
          </button>
        ),
      },
    ],
    [
      deleteEmployee,
      managersOf,
      employeeById,
      assignmentsOf,
      totalEtpOf,
      setAssignmentsEmployeeId,
      jobTitles,
      departments,
      departmentColorByName,
      comparatorFor,
    ],
  );

  const handleGridReady = useCallback((event: GridReadyEvent<Employee>) => {
    gridApiRef.current = event.api;
  }, []);

  const handleRowClicked = useCallback(
    (event: RowClickedEvent<Employee>) => {
      if (event.data) setSelectedEmployee(event.data.id);
    },
    [setSelectedEmployee],
  );

  const handleAddEmployee = useCallback(async () => {
    const created = await createEmployee({ first_name: '', last_name: '' });
    pinNewRow(created.id);
  }, [createEmployee, pinNewRow]);

  const handleExport = useCallback(() => {
    const csv = buildEmployeesCsv(employees, employeeById, managersOf, assignmentsOf, clientMissionById);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `employes_export_${date}.csv`);
  }, [employees, employeeById, managersOf, assignmentsOf, clientMissionById]);

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
          <button
            onClick={handleAddEmployee}
            className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white"
          >
            + Ajouter
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="min-h-0 flex-1" ref={containerRef}>
        <AgGridReact<Employee>
          theme={themeQuartz}
          rowData={mainRowData}
          pinnedTopRowData={pinnedTopRowData}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          loading={loading}
          quickFilterText={searchQuery}
          getRowStyle={getRowStyle}
          popupParent={containerRef.current ?? undefined}
          onGridReady={handleGridReady}
          onRowClicked={handleRowClicked}
          onCellValueChanged={handleCellValueChanged}
          onCellEditingStarted={handleCellEditingStarted}
          onCellFocused={handleCellFocused}
          animateRows
        />
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
    </div>
  );
}
