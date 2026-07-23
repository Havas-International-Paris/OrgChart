import { useCallback, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  AllCommunityModule,
  type CellValueChangedEvent,
  type ColDef,
  type GridReadyEvent,
} from 'ag-grid-community';
import { useDepartments } from '../../hooks/useDepartments';
import { departmentColorMap } from '../../lib/departmentColor';
import { useRowStabilizer } from './useRowStabilizer';
import { useUiPreferencesStore } from '../../stores/uiPreferencesStore';
import { getGridTheme, scaleColumnWidth } from '../../lib/gridTheme';
import type { Department } from '../../types/domain';

ModuleRegistry.registerModules([AllCommunityModule]);

export function DepartmentsGrid() {
  const { departments, loading, error, createDepartment, updateDepartment, deleteDepartment } =
    useDepartments();
  const gridDensity = useUiPreferencesStore((s) => s.gridDensity);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    gridApiRef,
    containerRef,
    pinnedTopId,
    pinNewRow,
    comparatorFor,
    handleCellEditingStarted,
    handleCellFocused,
  } = useRowStabilizer<Department>();

  const colorByName = useMemo(() => departmentColorMap(departments), [departments]);

  const mainRowData = useMemo(
    () => (pinnedTopId ? departments.filter((d) => d.id !== pinnedTopId) : departments),
    [departments, pinnedTopId],
  );
  const pinnedTopRowData = useMemo(() => {
    if (!pinnedTopId) return undefined;
    const row = departments.find((d) => d.id === pinnedTopId);
    return row ? [row] : undefined;
  }, [departments, pinnedTopId]);

  const handleGridReady = useCallback(
    (event: GridReadyEvent<Department>) => {
      gridApiRef.current = event.api;
    },
    [gridApiRef],
  );

  const handleCellValueChanged = useCallback(
    (event: CellValueChangedEvent<Department>) => {
      if (!event.data) return;
      updateDepartment(event.data.id, event.newValue).catch((err) =>
        setActionError(err instanceof Error ? err.message : String(err)),
      );
    },
    [updateDepartment],
  );

  const handleDelete = useCallback(
    (id: string) => {
      setActionError(null);
      deleteDepartment(id).catch((err) =>
        setActionError(err instanceof Error ? err.message : String(err)),
      );
    },
    [deleteDepartment],
  );

  const columnDefs = useMemo<ColDef<Department>[]>(
    () => [
      {
        headerName: 'Couleur',
        width: 80,
        sortable: false,
        filter: false,
        cellRenderer: (params: { data: Department }) => (
          <span
            className="mt-1.5 block h-3 w-3 rounded-full"
            style={{ backgroundColor: colorByName.get(params.data.name) }}
            title={colorByName.get(params.data.name)}
          />
        ),
      },
      {
        field: 'name',
        headerName: 'Business Unit',
        editable: true,
        flex: 1,
        minWidth: scaleColumnWidth(200, gridDensity),
        comparator: comparatorFor('name'),
      },
      {
        headerName: '',
        width: 56,
        sortable: false,
        filter: false,
        cellRenderer: (params: { data: Department }) => (
          <button
            onClick={() => handleDelete(params.data.id)}
            title="Supprimer"
            className="text-slate-400 hover:text-red-600"
          >
            ✕
          </button>
        ),
      },
    ],
    [handleDelete, comparatorFor, colorByName, gridDensity],
  );

  const handleAdd = useCallback(async () => {
    const created = await createDepartment('Nouvelle Business Unit');
    pinNewRow(created.id);
  }, [createDepartment, pinNewRow]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Business Units</h2>
        <button
          onClick={handleAdd}
          className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white"
        >
          + Ajouter
        </button>
      </div>
      {(error || actionError) && <p className="text-sm text-red-600">{error ?? actionError}</p>}
      <div className="min-h-0 flex-1" ref={containerRef}>
        <AgGridReact<Department>
          theme={getGridTheme(gridDensity)}
          rowData={mainRowData}
          pinnedTopRowData={pinnedTopRowData}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          loading={loading}
          popupParent={containerRef.current ?? undefined}
          onGridReady={handleGridReady}
          onCellValueChanged={handleCellValueChanged}
          onCellEditingStarted={handleCellEditingStarted}
          onCellFocused={handleCellFocused}
          animateRows
        />
      </div>
    </div>
  );
}
