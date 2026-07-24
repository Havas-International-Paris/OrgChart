import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as reportingService from '../services/reportingService';
import type { ReportingRelationship } from '../types/domain';
import { useHistoryStore } from '../stores/historyStore';
import { boxFor } from '../stores/idRegistryStore';

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
      // as a single command, not one per underlying write. Boxed the same
      // way addRelationship boxes a created row's id (idBox.ts): toDelete
      // rows come back with a fresh id on undo, toInsert rows get deleted
      // (and need re-creating with a fresh id again on redo).
      if (orgChartId) {
        const deletedBoxes = toDelete.map((r) => boxFor(r.id));
        const insertedBoxes = insertedRows.map((r) => boxFor(r.id));

        useHistoryStore.getState().push({
          label: 'Modifier les managers',
          orgChartId,
          undo: async () => {
            await Promise.all(
              toDelete.map(async (r, i) => {
                const recreated = await reportingService.createRelationship(
                  orgChartId,
                  r.employee_id,
                  r.manager_id,
                  r.is_primary,
                );
                deletedBoxes[i].id = recreated.id;
              }),
            );
            await Promise.all(insertedBoxes.map((box) => reportingService.deleteRelationship(box.id)));
            await Promise.all(
              toUpdate.map((d) => {
                const existing = currentByManager.get(d.managerId)!;
                return reportingService.updateRelationshipPrimary(existing.id, existing.is_primary);
              }),
            );
            await refresh();
          },
          redo: async () => {
            await Promise.all(deletedBoxes.map((box) => reportingService.deleteRelationship(box.id)));
            await Promise.all(
              toInsert.map(async (d, i) => {
                const recreated = await reportingService.createRelationship(
                  orgChartId,
                  employeeId,
                  d.managerId,
                  d.isPrimary,
                );
                insertedBoxes[i].id = recreated.id;
              }),
            );
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

  const addRelationship = useCallback(
    async (employeeId: string, managerId: string, isPrimary: boolean) => {
      if (!orgChartId) throw new Error('No active org chart');
      const created = await reportingService.createRelationship(orgChartId, employeeId, managerId, isPrimary);
      await refresh();
      // Boxed like an employee id (idBox.ts): if this same edge gets
      // reassigned/removed before an undo, then undone/redone, a plain
      // captured id would go stale the moment redo recreates the row under a
      // new id.
      const box = boxFor(created.id);
      useHistoryStore.getState().push({
        label: 'Ajouter un lien hiérarchique',
        orgChartId,
        undo: async () => {
          await reportingService.deleteRelationship(box.id);
          await refresh();
        },
        redo: async () => {
          const recreated = await reportingService.createRelationship(orgChartId, employeeId, managerId, isPrimary);
          box.id = recreated.id;
          await refresh();
        },
      });
      return created;
    },
    [refresh, orgChartId],
  );

  const removeRelationship = useCallback(
    async (relationship: ReportingRelationship) => {
      const box = boxFor(relationship.id);
      await reportingService.deleteRelationship(box.id);
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
            const recreated = await reportingService.createRelationship(
              orgChartId,
              relationship.employee_id,
              relationship.manager_id,
              relationship.is_primary,
            );
            box.id = recreated.id;
            await refresh();
          },
          redo: async () => {
            await reportingService.deleteRelationship(box.id);
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
    setRelationshipPrimary,
  };
}
