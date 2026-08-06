import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as orgChartService from '../services/orgChartService';
import type { OrgChart } from '../types/domain';

export function useOrgCharts() {
  const [orgCharts, setOrgCharts] = useState<OrgChart[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Mitigates a rare, hard-to-reproduce report: right after signing in, the
  // very first org_charts fetch can come back empty for an account that
  // legitimately has charts — a reload always then shows them correctly.
  // Root cause never conclusively pinned down (suspected: this hook's fetch
  // firing before supabase-js has fully attached the just-created session's
  // auth header to outgoing requests), so this is a bounded mitigation
  // rather than a real fix — one silent retry shortly after an empty
  // result, guarded so it can only ever fire once per mount and can't loop
  // for an account that genuinely has zero charts.
  const hasRetriedEmptyRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const result = await orgChartService.fetchOrgCharts();
      setOrgCharts(result);
      setError(null);
      if (result.length === 0 && !hasRetriedEmptyRef.current) {
        hasRetriedEmptyRef.current = true;
        setTimeout(() => {
          refresh();
        }, 1200);
      }
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
    updateOrgChart: async (id: string, changes: Partial<Pick<OrgChart, 'name' | 'short_label' | 'visibility'>>) => {
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
