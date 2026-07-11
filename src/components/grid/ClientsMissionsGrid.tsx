import { useCallback, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  AllCommunityModule,
  themeQuartz,
  type CellValueChangedEvent,
  type ColDef,
} from 'ag-grid-community';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import type { ClientMission } from '../../types/domain';

ModuleRegistry.registerModules([AllCommunityModule]);

export function ClientsMissionsGrid() {
  const { clientsMissions, loading, error, createClientMission, updateClientMission, deleteClientMission } =
    useClientsMissions();
  const [actionError, setActionError] = useState<string | null>(null);

  const handleCellValueChanged = useCallback(
    (event: CellValueChangedEvent<ClientMission>) => {
      const field = event.colDef.field as keyof ClientMission | undefined;
      if (!field || !event.data) return;
      updateClientMission(event.data.id, { [field]: event.newValue }).catch((err) =>
        setActionError(err instanceof Error ? err.message : String(err)),
      );
    },
    [updateClientMission],
  );

  const handleDelete = useCallback(
    (id: string) => {
      setActionError(null);
      deleteClientMission(id).catch(() =>
        setActionError(
          "Impossible de supprimer : ce client/mission est utilisé par au moins une affectation existante.",
        ),
      );
    },
    [deleteClientMission],
  );

  const columnDefs = useMemo<ColDef<ClientMission>[]>(
    () => [
      { field: 'name', headerName: 'Nom', editable: true, flex: 1, minWidth: 200 },
      {
        field: 'type',
        headerName: 'Type',
        editable: true,
        width: 120,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: ['client', 'mission'] },
        valueFormatter: (params) => (params.value === 'mission' ? 'Mission' : 'Client'),
      },
      {
        headerName: '',
        width: 56,
        sortable: false,
        filter: false,
        cellRenderer: (params: { data: ClientMission }) => (
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
        <h2 className="text-sm font-semibold text-slate-700">Clients / Missions</h2>
        <button
          onClick={() => createClientMission('Nouveau', 'client')}
          className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white"
        >
          + Ajouter
        </button>
      </div>
      {(error || actionError) && <p className="text-sm text-red-600">{error ?? actionError}</p>}
      <div className="min-h-0 flex-1">
        <AgGridReact<ClientMission>
          theme={themeQuartz}
          rowData={clientsMissions}
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
