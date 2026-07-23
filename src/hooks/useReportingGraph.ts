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

    // Unique per mount: see useEmployees.ts for why a fixed channel name
    // breaks. Deliberately unfiltered (no org_chart_id filter) for the same
    // reason documented there — a filter on a non-PK column silently drops
    // DELETE events under Postgres's default replica identity.
    const channel = supabase
      .channel(`reporting-relationships-changes-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reporting_relationships',
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

  const removeRelationship = useCallback(
    async (relationship: ReportingRelationship) => {
      await reportingService.deleteRelationship(relationship.id);
      // Mirrors ManagerEditorModal's existing toggle() behavior: if the
      // deleted link was primary and other managers remain, auto-promote
      // one of them rather than silently leaving the employee un-owned.
      if (relationship.is_primary) {
        const remaining = relationships.filter(
          (r) => r.employee_id === relationship.employee_id && r.id !== relationship.id,
        );
        if (remaining.length > 0) {
          await reportingService.updateRelationshipPrimary(remaining[0].id, true);
        }
      }
      await refresh();
    },
    [relationships, refresh],
  );

  const reassignManager = useCallback(
    async (relationship: ReportingRelationship, newManagerId: string) => {
      await reportingService.updateRelationshipManager(relationship.id, newManagerId);
      await refresh();
    },
    [refresh],
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
    removeRelationship,
    reassignManager,
  };
}
