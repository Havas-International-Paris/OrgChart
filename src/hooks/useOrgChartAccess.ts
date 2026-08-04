import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as orgChartAccessService from '../services/orgChartAccessService';
import type { OrgChartAccess, OrgChartAccessRole } from '../types/domain';

// Only meaningful for the chart's owner/an admin (RLS restricts
// org_chart_access writes to them, see 0017_org_chart_sharing.sql) — a
// non-owner viewing this chart just gets an empty access list back.
export function useOrgChartAccess(orgChartId: string | null) {
  const [access, setAccess] = useState<OrgChartAccess[]>([]);
  const [activeUsers, setActiveUsers] = useState<{ user_id: string; email: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!orgChartId) return;
    const [accessRows, users] = await Promise.all([
      orgChartAccessService.fetchAccess(orgChartId),
      orgChartAccessService.listActiveUsers(),
    ]);
    setAccess(accessRows);
    setActiveUsers(users);
    setLoading(false);
  }, [orgChartId]);

  useEffect(() => {
    if (!orgChartId) return;
    setLoading(true);
    refresh();

    // Unique per mount, same convention as every other data hook (see
    // CLAUDE.md) — a fixed channel name breaks under React StrictMode's
    // double-mount or multiple simultaneous consumers.
    const channel = supabase
      .channel(`org-chart-access-changes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'org_chart_access' }, () => refresh())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgChartId, refresh]);

  return {
    access,
    activeUsers,
    loading,
    grantAccess: async (userId: string, role: OrgChartAccessRole) => {
      if (!orgChartId) return;
      await orgChartAccessService.grantAccess(orgChartId, userId, role);
      await refresh();
    },
    revokeAccess: async (userId: string) => {
      if (!orgChartId) return;
      await orgChartAccessService.revokeAccess(orgChartId, userId);
      await refresh();
    },
  };
}
