import { useCallback, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  AllCommunityModule,
  themeQuartz,
  type CellValueChangedEvent,
  type ColDef,
} from 'ag-grid-community';
import { useJobTitles } from '../../hooks/useJobTitles';
import type { JobTitle } from '../../types/domain';

ModuleRegistry.registerModules([AllCommunityModule]);

export function JobTitlesGrid() {
  const { jobTitles, loading, error, createJobTitle, updateJobTitle, deleteJobTitle } = useJobTitles();
  const [actionError, setActionError] = useState<string | null>(null);

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
      { field: 'name', headerName: 'Poste', editable: true, flex: 1, minWidth: 200 },
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
    [handleDelete],
  );

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Postes</h2>
        <button
          onClick={() => createJobTitle('Nouveau poste')}
          className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white"
        >
          + Ajouter
        </button>
      </div>
      {(error || actionError) && <p className="text-sm text-red-600">{error ?? actionError}</p>}
      <div className="min-h-0 flex-1">
        <AgGridReact<JobTitle>
          theme={themeQuartz}
          rowData={jobTitles}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          loading={loading}
          onCellValueChanged={handleCellValueChanged}
          animateRows
        />
      </div>
    </div>
  );
}
