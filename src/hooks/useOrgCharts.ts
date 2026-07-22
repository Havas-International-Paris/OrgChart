import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as orgChartService from '../services/orgChartService';
import type { OrgChart } from '../types/domain';

export function useOrgCharts() {
  const [orgCharts, setOrgCharts] = useState<OrgChart[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setOrgCharts(await orgChartService.fetchOrgCharts());
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
      .channel(`org-charts-changes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'org_charts' }, () => refresh())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  return {
    orgCharts,
    loading,
    error,
    createOrgChart: async (name: string, shortLabel: string) => {
      const created = await orgChartService.createOrgChart(name, shortLabel);
      await refresh();
      return created;
    },
    updateOrgChart: async (id: string, changes: Partial<Pick<OrgChart, 'name' | 'short_label'>>) => {
      await orgChartService.updateOrgChart(id, changes);
      await refresh();
    },
    duplicateOrgChart: async (sourceId: string, newName: string, newShortLabel: string) => {
      const newId = await orgChartService.duplicateOrgChart(sourceId, newName, newShortLabel);
      await refresh();
      return newId;
    },
    deleteOrgChart: async (id: string) => {
      await orgChartService.deleteOrgChart(id);
      await refresh();
    },
  };
}
