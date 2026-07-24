import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as clientMissionService from '../services/clientMissionService';
import type { ClientMission, ClientMissionType } from '../types/domain';
import { useHistoryStore } from '../stores/historyStore';
import { boxFor } from '../stores/idRegistryStore';
import { useSelectionStore } from '../stores/selectionStore';

export function useClientsMissions() {
  const [clientsMissions, setClientsMissions] = useState<ClientMission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setClientsMissions(await clientMissionService.fetchClientsMissions());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    const channel = supabase
      .channel(`clients-missions-changes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients_missions' }, () =>
        refresh(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const findOrCreate = useCallback(
    async (name: string, type: ClientMissionType): Promise<ClientMission> => {
      const existing = clientsMissions.find(
        (cm) => cm.type === type && cm.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing) return existing;
      const created = await clientMissionService.createClientMission(name, type);
      await refresh();
      return created;
    },
    [clientsMissions, refresh],
  );

  const updateClientMission = useCallback(
    async (
      id: string,
      changes: Partial<Pick<ClientMission, 'name' | 'type'>>,
      // AG Grid mutates its row data object in place before firing
      // onCellValueChanged (see useEmployees.ts's updateEmployee for the
      // full explanation) — ClientsMissionsGrid passes the event's real
      // oldValue here since clientsMissions.find(id) can't be trusted once
      // that's already happened.
      oldValuesHint?: Partial<Pick<ClientMission, 'name' | 'type'>>,
    ) => {
      const before = clientsMissions.find((cm) => cm.id === id);
      await clientMissionService.updateClientMission(id, changes);
      await refresh();
      // clients_missions is a global catalog, not chart-scoped (see
      // employees/reporting_relationships/assignments for the scoped ones) —
      // history itself is still cleared per chart switch (see AppShell.tsx's
      // switchOrgChart), so this just records against whichever chart is
      // current when the edit happens.
      const orgChartId = useSelectionStore.getState().currentOrgChartId;
      if (before && orgChartId) {
        const box = boxFor(id);
        const oldChanges: Partial<Pick<ClientMission, 'name' | 'type'>> = {};
        for (const key of Object.keys(changes) as (keyof typeof changes)[]) {
          (oldChanges as Record<string, unknown>)[key] =
            oldValuesHint && key in oldValuesHint ? oldValuesHint[key] : before[key];
        }
        useHistoryStore.getState().push({
          label: `Modifier ${before.name}`,
          orgChartId,
          undo: async () => { await updateClientMission(box.id, oldChanges); },
          redo: async () => { await updateClientMission(box.id, changes); },
        });
      }
    },
    [clientsMissions, refresh],
  );

  const deleteClientMission = useCallback(
    async (id: string) => {
      const before = clientsMissions.find((cm) => cm.id === id);
      await clientMissionService.deleteClientMission(id);
      await refresh();
      const orgChartId = useSelectionStore.getState().currentOrgChartId;
      if (before && orgChartId) {
        const box = boxFor(id);
        useHistoryStore.getState().push({
          label: `Supprimer ${before.name}`,
          orgChartId,
          undo: async () => {
            const recreated = await clientMissionService.createClientMission(before.name, before.type);
            box.id = recreated.id;
            await refresh();
          },
          redo: async () => {
            await clientMissionService.deleteClientMission(box.id);
            await refresh();
          },
        });
      }
    },
    [clientsMissions, refresh],
  );

  const createClientMission = useCallback(
    async (name: string, type: ClientMissionType) => {
      const created = await clientMissionService.createClientMission(name, type);
      await refresh();
      const orgChartId = useSelectionStore.getState().currentOrgChartId;
      const box = boxFor(created.id);
      if (orgChartId) {
        useHistoryStore.getState().push({
          label: `Créer ${created.name}`,
          orgChartId,
          undo: async () => {
            await clientMissionService.deleteClientMission(box.id);
            await refresh();
          },
          redo: async () => {
            const recreated = await clientMissionService.createClientMission(name, type);
            box.id = recreated.id;
            await refresh();
          },
        });
      }
      return created;
    },
    [refresh],
  );

  return {
    clientsMissions,
    loading,
    error,
    findOrCreate,
    createClientMission,
    updateClientMission,
    deleteClientMission,
  };
}
