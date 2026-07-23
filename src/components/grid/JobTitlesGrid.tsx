import { useCallback, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  AllCommunityModule,
  type CellValueChangedEvent,
  type ColDef,
  type GridReadyEvent,
} from 'ag-grid-community';
import { useJobTitles } from '../../hooks/useJobTitles';
import { useRowStabilizer } from './useRowStabilizer';
import { useUiPreferencesStore } from '../../stores/uiPreferencesStore';
import { getGridTheme, scaleColumnWidth } from '../../lib/gridTheme';
import type { JobTitle } from '../../types/domain';

ModuleRegistry.registerModules([AllCommunityModule]);

export function JobTitlesGrid() {
  const { jobTitles, loading, error, createJobTitle, updateJobTitle, deleteJobTitle } = useJobTitles();
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
  } = useRowStabilizer<JobTitle>();

  const mainRowData = useMemo(
    () => (pinnedTopId ? jobTitles.filter((jt) => jt.id !== pinnedTopId) : jobTitles),
    [jobTitles, pinnedTopId],
  );
  const pinnedTopRowData = useMemo(() => {
    if (!pinnedTopId) return undefined;
    const row = jobTitles.find((jt) => jt.id === pinnedTopId);
    return row ? [row] : undefined;
  }, [jobTitles, pinnedTopId]);

  const handleGridReady = useCallback(
    (event: GridReadyEvent<JobTitle>) => {
      gridApiRef.current = event.api;
    },
    [gridApiRef],
  );

  const handleCellValueChanged = useCallback(
    (event: CellValueChangedEvent<JobTitle>) => {
      if (!event.data) return;
      updateJobTitle(event.data.id, event.newValue).catch((err) =>
        setActionError(err instanceof Error ? err.message : String(err)),
      );
    },
    [updateJobTitle],
  );

  const handleDelete = useCallback(
    (id: string) => {
      setActionError(null);
      deleteJobTitle(id).catch((err) =>
        setActionError(err instanceof Error ? err.message : String(err)),
      );
    },
    [deleteJobTitle],
  );

  const columnDefs = useMemo<ColDef<JobTitle>[]>(
    () => [
      {
        field: 'name',
        headerName: 'Poste',
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
        cellRenderer: (params: { data: JobTitle }) => (
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
    [handleDelete, comparatorFor, gridDensity],
  );

  const handleAdd = useCallback(async () => {
    const created = await createJobTitle('Nouveau poste');
    pinNewRow(created.id);
  }, [createJobTitle, pinNewRow]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Postes</h2>
        <button
          onClick={handleAdd}
          className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white"
        >
          + Ajouter
        </button>
      </div>
      {(error || actionError) && <p className="text-sm text-red-600">{error ?? actionError}</p>}
      <div className="min-h-0 flex-1" ref={containerRef}>
        <AgGridReact<JobTitle>
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
