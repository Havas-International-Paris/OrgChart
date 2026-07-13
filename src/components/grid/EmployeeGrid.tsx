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
import { useJobTitles } from '../../hooks/useJobTitles';
import { useSelectionStore } from '../../stores/selectionStore';
import { nameColumnDefs, roleDescColumnDef } from './gridColumnDefs';
import { useRowStabilizer } from './useRowStabilizer';
import { ManagerEditorModal } from '../shared/ManagerEditorModal';
import type { Employee } from '../../types/domain';

ModuleRegistry.registerModules([AllCommunityModule]);

export function EmployeeGrid() {
  const { employees, loading, error, createEmployee, updateEmployee, deleteEmployee } = useEmployees();
  const { managersOf, wouldCreateCycle, replaceManagersForEmployee } = useReportingGraph();
  const { assignmentsOf, totalEtpOf } = useAssignments();
  const { jobTitles } = useJobTitles();
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
          return (
            <button
              onClick={() => setAssignmentsEmployeeId(params.data.id)}
              className={`w-full truncate text-left text-sm hover:underline ${
                count === 0 ? 'text-slate-300' : total === 100 ? 'text-emerald-700' : 'text-amber-700'
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

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Employés</h2>
        <button
          onClick={handleAddEmployee}
          className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white"
        >
          + Ajouter
        </button>
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
