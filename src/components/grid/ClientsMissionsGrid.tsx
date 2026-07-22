import { useCallback, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  AllCommunityModule,
  themeQuartz,
  type CellValueChangedEvent,
  type ColDef,
  type GridReadyEvent,
} from 'ag-grid-community';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { useAssignments } from '../../hooks/useAssignments';
import { useEmployees } from '../../hooks/useEmployees';
import { useSelectionStore } from '../../stores/selectionStore';
import { useRowStabilizer } from './useRowStabilizer';
import { etpStatus } from '../../lib/etpStatus';
import { ClientAssignmentsModal } from '../shared/ClientAssignmentsModal';
import type { ClientMission } from '../../types/domain';

ModuleRegistry.registerModules([AllCommunityModule]);

export function ClientsMissionsGrid() {
  const currentOrgChartId = useSelectionStore((s) => s.currentOrgChartId);
  const { clientsMissions, loading, error, createClientMission, updateClientMission, deleteClientMission } =
    useClientsMissions();
  const {
    assignmentsOfClientMission,
    totalEtpOfClientMission,
    totalEtpReelOfClientMission,
    createAssignment,
    updateAssignmentEtpVendu,
    updateAssignmentEtpReel,
    updateAssignmentRemuneration,
    deleteAssignment,
  } = useAssignments(currentOrgChartId);
  const { employees } = useEmployees(currentOrgChartId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewingAssignmentsFor, setViewingAssignmentsFor] = useState<ClientMission | null>(null);

  const {
    gridApiRef,
    containerRef,
    pinnedTopId,
    pinNewRow,
    comparatorFor,
    handleCellEditingStarted,
    handleCellFocused,
  } = useRowStabilizer<ClientMission>();

  const mainRowData = useMemo(
    () => (pinnedTopId ? clientsMissions.filter((cm) => cm.id !== pinnedTopId) : clientsMissions),
    [clientsMissions, pinnedTopId],
  );
  const pinnedTopRowData = useMemo(() => {
    if (!pinnedTopId) return undefined;
    const row = clientsMissions.find((cm) => cm.id === pinnedTopId);
    return row ? [row] : undefined;
  }, [clientsMissions, pinnedTopId]);

  const handleGridReady = useCallback(
    (event: GridReadyEvent<ClientMission>) => {
      gridApiRef.current = event.api;
    },
    [gridApiRef],
  );

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
      {
        field: 'name',
        headerName: 'Nom',
        editable: true,
        flex: 1,
        minWidth: 200,
        comparator: comparatorFor('name'),
      },
      {
        field: 'type',
        headerName: 'Type',
        editable: true,
        width: 120,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: ['client', 'mission'] },
        valueFormatter: (params) => (params.value === 'mission' ? 'Mission' : 'Client'),
        comparator: comparatorFor('type'),
      },
      {
        headerName: 'Employés',
        flex: 1,
        minWidth: 140,
        sortable: false,
        filter: false,
        cellRenderer: (params: { data: ClientMission }) => {
          const count = assignmentsOfClientMission(params.data.id).length;
          const total = totalEtpOfClientMission(params.data.id);
          const status = etpStatus(total);
          return (
            <button
              onClick={() => setViewingAssignmentsFor(params.data)}
              className={`w-full truncate text-left text-sm hover:underline ${
                count === 0
                  ? 'text-slate-300'
                  : status === 'green'
                    ? 'text-emerald-700'
                    : status === 'amber'
                      ? 'text-amber-700'
                      : 'text-red-700'
              }`}
              title="Voir le détail par employé"
            >
              {count === 0 ? '+ Ajouter' : `${count} · ${total}% vendu`}
            </button>
          );
        },
      },
      {
        headerName: 'Total réel',
        width: 100,
        sortable: false,
        filter: false,
        cellRenderer: (params: { data: ClientMission }) => {
          const assignments = assignmentsOfClientMission(params.data.id);
          const known = assignments.filter((a) => a.etp_reel !== null);
          const total = totalEtpReelOfClientMission(params.data.id);
          return (
            <span className="text-sm text-slate-400">{known.length > 0 ? `${total}%` : '—'}</span>
          );
        },
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
    [handleDelete, comparatorFor, assignmentsOfClientMission, totalEtpOfClientMission, totalEtpReelOfClientMission],
  );

  const handleAdd = useCallback(async () => {
    const created = await createClientMission('Nouveau', 'client');
    pinNewRow(created.id);
  }, [createClientMission, pinNewRow]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Clients / Missions</h2>
        <button
          onClick={handleAdd}
          className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white"
        >
          + Ajouter
        </button>
      </div>
      {(error || actionError) && <p className="text-sm text-red-600">{error ?? actionError}</p>}
      <div className="min-h-0 flex-1" ref={containerRef}>
        <AgGridReact<ClientMission>
          theme={themeQuartz}
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
      {viewingAssignmentsFor && (
        <ClientAssignmentsModal
          clientMission={viewingAssignmentsFor}
          assignments={assignmentsOfClientMission(viewingAssignmentsFor.id)}
          employees={employees}
          createAssignment={createAssignment}
          updateAssignmentEtpVendu={updateAssignmentEtpVendu}
          updateAssignmentEtpReel={updateAssignmentEtpReel}
          updateAssignmentRemuneration={updateAssignmentRemuneration}
          deleteAssignment={deleteAssignment}
          onClose={() => setViewingAssignmentsFor(null)}
        />
      )}
    </div>
  );
}
