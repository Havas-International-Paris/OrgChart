import { useCallback, useRef, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as reportingService from '../services/reportingService';
import type { ReportingRelationship } from '../types/domain';
import { useHistoryStore } from '../stores/historyStore';

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

  // Stale-response guard — see useEmployees.ts for the full why. Short version:
  // the unfiltered realtime subscription makes refresh() fire on any change to
  // this table anywhere, so a fetch for the previous chart can resolve after a
  // switch and overwrite the new chart's data.
  const latestRequestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!orgChartId) return;
    const requestId = ++latestRequestRef.current;
    try {
      const rows = await reportingService.fetchReportingRelationships(orgChartId);
      if (requestId !== latestRequestRef.current) return;
      setRelationships(rows);
      setError(null);
    } catch (err) {
      if (requestId !== latestRequestRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestId === latestRequestRef.current) setLoading(false);
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

      const insertedRows = await Promise.all(
        toInsert.map((d) => {
          if (!orgChartId) throw new Error('No active org chart');
          return reportingService.createRelationship(orgChartId, employeeId, d.managerId, d.isPrimary);
        }),
      );
      await Promise.all(
        toUpdate
          .filter((d) => d.isPrimary)
          .map((d) =>
            reportingService.updateRelationshipPrimary(currentByManager.get(d.managerId)!.id, true),
          ),
      );

      await refresh();

      // One save in ManagerEditorModal is one user action — even though it
      // may batch several deletes/inserts/promotions — so it must undo/redo
      // as a single command, not one per underlying write. Every row involved
      // keeps its original id across the cycle because both directions
      // RESTORE rows rather than create replacements.
      if (orgChartId) {
        useHistoryStore.getState().push({
          label: 'Modifier les managers',
          orgChartId,
          undo: async () => {
            await Promise.all(toDelete.map((r) => reportingService.restoreRelationship(r)));
            await Promise.all(insertedRows.map((r) => reportingService.deleteRelationship(r.id)));
            await Promise.all(
              toUpdate.map((d) => {
                const existing = currentByManager.get(d.managerId)!;
                return reportingService.updateRelationshipPrimary(existing.id, existing.is_primary);
              }),
            );
            await refresh();
          },
          redo: async () => {
            await Promise.all(toDelete.map((r) => reportingService.deleteRelationship(r.id)));
            await Promise.all(insertedRows.map((r) => reportingService.restoreRelationship(r)));
            await Promise.all(
              toUpdate.map((d) =>
                reportingService.updateRelationshipPrimary(currentByManager.get(d.managerId)!.id, d.isPrimary),
              ),
            );
            await refresh();
          },
        });
      }
    },
    [relationships, refresh, orgChartId],
  );

  // Thin wrapper over the existing service call, used only by removeRelationship's
  // undo (to demote a manager it auto-promoted) and by replaceManagersForEmployee's
  // undo — everywhere else that flips is_primary goes through those two.
  const setRelationshipPrimary = useCallback(
    async (id: string, isPrimary: boolean) => {
      await reportingService.updateRelationshipPrimary(id, isPrimary);
      await refresh();
    },
    [refresh],
  );

  // Undo-only helper — see useEmployees.ts's restoreEmployee. Not recorded.
  const restoreRelationship = useCallback(
    async (row: ReportingRelationship): Promise<ReportingRelationship> => {
      const restored = await reportingService.restoreRelationship(row);
      await refresh();
      return restored;
    },
    [refresh],
  );

  const addRelationship = useCallback(
    async (employeeId: string, managerId: string, isPrimary: boolean) => {
      if (!orgChartId) throw new Error('No active org chart');
      const created = await reportingService.createRelationship(orgChartId, employeeId, managerId, isPrimary);
      await refresh();
      useHistoryStore.getState().push({
        label: 'Ajouter un lien hiérarchique',
        orgChartId,
        undo: async () => {
          await reportingService.deleteRelationship(created.id);
          await refresh();
        },
        redo: async () => {
          await reportingService.restoreRelationship(created);
          await refresh();
        },
      });
      return created;
    },
    [refresh, orgChartId],
  );

  const removeRelationship = useCallback(
    async (relationship: ReportingRelationship) => {
      await reportingService.deleteRelationship(relationship.id);
      // Mirrors ManagerEditorModal's existing toggle() behavior: if the
      // deleted link was primary and other managers remain, auto-promote
      // one of them rather than silently leaving the employee un-owned.
      let promoted: ReportingRelationship | null = null;
      if (relationship.is_primary) {
        const remaining = relationships.filter(
          (r) => r.employee_id === relationship.employee_id && r.id !== relationship.id,
        );
        if (remaining.length > 0) {
          promoted = remaining[0];
          await reportingService.updateRelationshipPrimary(promoted.id, true);
        }
      }
      await refresh();
      if (orgChartId) {
        useHistoryStore.getState().push({
          label: 'Supprimer un lien hiérarchique',
          orgChartId,
          undo: async () => {
            if (promoted) await setRelationshipPrimary(promoted.id, false);
            await reportingService.restoreRelationship(relationship);
            await refresh();
          },
          redo: async () => {
            await reportingService.deleteRelationship(relationship.id);
            if (promoted) await reportingService.updateRelationshipPrimary(promoted.id, true);
            await refresh();
          },
        });
      }
    },
    [relationships, refresh, orgChartId, setRelationshipPrimary],
  );

  const reassignManager = useCallback(
    async (relationship: ReportingRelationship, newManagerId: string) => {
      const oldManagerId = relationship.manager_id;
      await reportingService.updateRelationshipManager(relationship.id, newManagerId);
      await refresh();
      if (orgChartId) {
        useHistoryStore.getState().push({
          label: 'Réaffecter un manager',
          orgChartId,
          undo: async () => { await reassignManager(relationship, oldManagerId); },
          redo: async () => { await reassignManager(relationship, newManagerId); },
        });
      }
    },
    [refresh, orgChartId],
  );

  // Memoized like every other value this hook returns — an unmemoized
  // closure here was cascading into useChartActions.ts's computeDropValidity/
  // handleReassignManager, and from there into the chart's own node array,
  // making it churn a new reference every render (see useEmployees.ts's
  // mutators for the fuller story on why that broke node dragging).
  const checkWouldCreateCycle = useCallback(
    (employeeId: string, managerId: string) => wouldCreateCycle(relationships, employeeId, managerId),
    [relationships],
  );

  return {
    relationships,
    loading,
    error,
    managersOf,
    directReportsOf,
    wouldCreateCycle: checkWouldCreateCycle,
    replaceManagersForEmployee,
    addRelationship,
    restoreRelationship,
    removeRelationship,
    reassignManager,
    setRelationshipPrimary,
  };
}
