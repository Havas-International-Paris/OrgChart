import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as clientMissionService from '../services/clientMissionService';
import type { ClientMission, ClientMissionType } from '../types/domain';

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
    async (id: string, changes: Partial<Pick<ClientMission, 'name' | 'type'>>) => {
      await clientMissionService.updateClientMission(id, changes);
      await refresh();
    },
    [refresh],
  );

  const deleteClientMission = useCallback(
    async (id: string) => {
      await clientMissionService.deleteClientMission(id);
      await refresh();
    },
    [refresh],
  );

  return {
    clientsMissions,
    loading,
    error,
    findOrCreate,
    createClientMission: async (name: string, type: ClientMissionType) => {
      const created = await clientMissionService.createClientMission(name, type);
      await refresh();
      return created;
    },
    updateClientMission,
    deleteClientMission,
  };
}
