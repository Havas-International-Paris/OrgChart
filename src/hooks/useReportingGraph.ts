import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as reportingService from '../services/reportingService';
import type { ReportingRelationship } from '../types/domain';

export function wouldCreateCycle(
  relationships: ReportingRelationship[],
  employeeId: string,
  managerId: string,
): boolean {
  if (employeeId === managerId) return true;

  const visited = new Set<string>();
  const queue = [managerId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const rel of relationships) {
      if (rel.employee_id !== current) continue;
      if (rel.manager_id === employeeId) return true;
      queue.push(rel.manager_id);
    }
  }

  return false;
}

export interface DesiredManager {
  managerId: string;
  isPrimary: boolean;
}

export function useReportingGraph(orgChartId: string | null) {
  const [relationships, setRelationships] = useState<ReportingRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!orgChartId) return;
    try {
      setRelationships(await reportingService.fetchReportingRelationships(orgChartId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgChartId]);

  useEffect(() => {
    if (!orgChartId) return;
    // Reset to a clean loading state before fetching the new chart's data —
    // see useEmployees.ts for why.
    setRelationships([]);
    setLoading(true);
    refresh();

    // Unique per mount: see useEmployees.ts for why a fixed channel name breaks.
    const channel = supabase
      .channel(`reporting-relationships-changes-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reporting_relationships',
          filter: `org_chart_id=eq.${orgChartId}`,
        },
        () => refresh(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgChartId, refresh]);

  const managersOf = useCallback(
    (employeeId: string) => relationships.filter((r) => r.employee_id === employeeId),
    [relationships],
  );

  const directReportsOf = useCallback(
    (managerId: string) => relationships.filter((r) => r.manager_id === managerId),
    [relationships],
  );

  const replaceManagersForEmployee = useCallback(
    async (employeeId: string, desired: DesiredManager[]) => {
      const current = relationships.filter((r) => r.employee_id === employeeId);
      const currentByManager = new Map(current.map((r) => [r.manager_id, r]));
      const desiredByManager = new Map(desired.map((d) => [d.managerId, d]));

      const toDelete = current.filter((r) => !desiredByManager.has(r.manager_id));
      const toInsert = desired.filter((d) => !currentByManager.has(d.managerId));
      const toUpdate = desired.filter((d) => {
        const existing = currentByManager.get(d.managerId);
        return existing && existing.is_primary !== d.isPrimary;
      });

      // Demote/delete first, then promote/insert, so the "at most one primary
      // manager" constraint is never transiently violated by concurrent writes.
      await Promise.all([
        ...toDelete.map((r) => reportingService.deleteRelationship(r.id)),
        ...toUpdate
          .filter((d) => !d.isPrimary)
          .map((d) =>
            reportingService.updateRelationshipPrimary(currentByManager.get(d.managerId)!.id, false),
          ),
      ]);

      await Promise.all([
        ...toInsert.map((d) => {
          if (!orgChartId) throw new Error('No active org chart');
          return reportingService.createRelationship(orgChartId, employeeId, d.managerId, d.isPrimary);
        }),
        ...toUpdate
          .filter((d) => d.isPrimary)
          .map((d) =>
            reportingService.updateRelationshipPrimary(currentByManager.get(d.managerId)!.id, true),
          ),
      ]);

      await refresh();
    },
    [relationships, refresh, orgChartId],
  );

  const addRelationship = useCallback(
    async (employeeId: string, managerId: string, isPrimary: boolean) => {
      if (!orgChartId) throw new Error('No active org chart');
      await reportingService.createRelationship(orgChartId, employeeId, managerId, isPrimary);
      await refresh();
    },
    [refresh, orgChartId],
  );

  return {
    relationships,
    loading,
    error,
    managersOf,
    directReportsOf,
    wouldCreateCycle: (employeeId: string, managerId: string) =>
      wouldCreateCycle(relationships, employeeId, managerId),
    replaceManagersForEmployee,
    addRelationship,
  };
}
