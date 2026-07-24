import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as assignmentService from '../services/assignmentService';
import type { Assignment, RemunerationModel } from '../types/domain';
import { useHistoryStore } from '../stores/historyStore';
import { boxFor } from '../stores/idRegistryStore';

export function useAssignments(orgChartId: string | null) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!orgChartId) return;
    try {
      setAssignments(await assignmentService.fetchAssignments(orgChartId));
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
    setAssignments([]);
    setLoading(true);
    refresh();

    // Deliberately unfiltered — see useEmployees.ts's channel setup for why
    // a filter on a non-PK column like org_chart_id silently drops DELETE
    // events under Postgres's default replica identity.
    const channel = supabase
      .channel(`assignments-changes-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assignments' },
        () => refresh(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgChartId, refresh]);

  const assignmentsOf = useCallback(
    (employeeId: string) => assignments.filter((a) => a.employee_id === employeeId),
    [assignments],
  );

  const totalEtpOf = useCallback(
    (employeeId: string) => assignmentsOf(employeeId).reduce((sum, a) => sum + (a.etp_vendu ?? 0), 0),
    [assignmentsOf],
  );

  const totalEtpReelOf = useCallback(
    (employeeId: string) => assignmentsOf(employeeId).reduce((sum, a) => sum + (a.etp_reel ?? 0), 0),
    [assignmentsOf],
  );

  const assignmentsOfClientMission = useCallback(
    (clientMissionId: string) => assignments.filter((a) => a.client_mission_id === clientMissionId),
    [assignments],
  );

  const totalEtpOfClientMission = useCallback(
    (clientMissionId: string) =>
      assignmentsOfClientMission(clientMissionId).reduce((sum, a) => sum + (a.etp_vendu ?? 0), 0),
    [assignmentsOfClientMission],
  );

  const totalEtpReelOfClientMission = useCallback(
    (clientMissionId: string) =>
      assignmentsOfClientMission(clientMissionId).reduce((sum, a) => sum + (a.etp_reel ?? 0), 0),
    [assignmentsOfClientMission],
  );

  const createAssignment = useCallback(
    async (
      employeeId: string,
      clientMissionId: string,
      etpVendu: number | null,
      etpReel: number | null,
      remunerationModel: RemunerationModel | null,
    ) => {
      if (!orgChartId) throw new Error('No active org chart');
      const created = await assignmentService.createAssignment(
        orgChartId,
        employeeId,
        clientMissionId,
        etpVendu,
        etpReel,
        remunerationModel,
      );
      await refresh();
      const box = boxFor(created.id);
      useHistoryStore.getState().push({
        label: 'Ajouter une affectation',
        orgChartId,
        undo: async () => {
          await assignmentService.deleteAssignment(box.id);
          await refresh();
        },
        redo: async () => {
          const recreated = await assignmentService.createAssignment(
            orgChartId,
            employeeId,
            clientMissionId,
            etpVendu,
            etpReel,
            remunerationModel,
          );
          box.id = recreated.id;
          await refresh();
        },
      });
      return created;
    },
    [refresh, orgChartId],
  );

  const updateAssignmentEtpVendu = useCallback(
    async (id: string, etpVendu: number | null) => {
      const before = assignments.find((a) => a.id === id);
      await assignmentService.updateAssignmentEtpVendu(id, etpVendu);
      await refresh();
      if (before && orgChartId) {
        const box = boxFor(id);
        const oldEtpVendu = before.etp_vendu;
        useHistoryStore.getState().push({
          label: 'Modifier le % vendu',
          orgChartId,
          undo: async () => { await updateAssignmentEtpVendu(box.id, oldEtpVendu); },
          redo: async () => { await updateAssignmentEtpVendu(box.id, etpVendu); },
        });
      }
    },
    [assignments, refresh, orgChartId],
  );

  const updateAssignmentEtpReel = useCallback(
    async (id: string, etpReel: number | null) => {
      const before = assignments.find((a) => a.id === id);
      await assignmentService.updateAssignmentEtpReel(id, etpReel);
      await refresh();
      if (before && orgChartId) {
        const box = boxFor(id);
        const oldEtpReel = before.etp_reel;
        useHistoryStore.getState().push({
          label: 'Modifier le % réel',
          orgChartId,
          undo: async () => { await updateAssignmentEtpReel(box.id, oldEtpReel); },
          redo: async () => { await updateAssignmentEtpReel(box.id, etpReel); },
        });
      }
    },
    [assignments, refresh, orgChartId],
  );

  const updateAssignmentRemuneration = useCallback(
    async (id: string, remunerationModel: RemunerationModel | null, clearVendu: boolean) => {
      const before = assignments.find((a) => a.id === id);
      await assignmentService.updateAssignmentRemuneration(id, remunerationModel, clearVendu);
      await refresh();
      if (before && orgChartId) {
        const box = boxFor(id);
        const oldModel = before.remuneration_model;
        const oldEtpVendu = before.etp_vendu;
        useHistoryStore.getState().push({
          label: 'Modifier le modèle de rémunération',
          orgChartId,
          undo: async () => {
            await assignmentService.updateAssignmentRemuneration(box.id, oldModel, false);
            if (oldEtpVendu !== null) await assignmentService.updateAssignmentEtpVendu(box.id, oldEtpVendu);
            await refresh();
          },
          redo: async () => {
            await assignmentService.updateAssignmentRemuneration(box.id, remunerationModel, clearVendu);
            await refresh();
          },
        });
      }
    },
    [assignments, refresh, orgChartId],
  );

  const deleteAssignment = useCallback(
    async (id: string) => {
      const before = assignments.find((a) => a.id === id);
      await assignmentService.deleteAssignment(id);
      await refresh();
      if (before && orgChartId) {
        const box = boxFor(id);
        useHistoryStore.getState().push({
          label: 'Supprimer une affectation',
          orgChartId,
          undo: async () => {
            const recreated = await assignmentService.createAssignment(
              orgChartId,
              before.employee_id,
              before.client_mission_id,
              before.etp_vendu,
              before.etp_reel,
              before.remuneration_model,
            );
            box.id = recreated.id;
            await refresh();
          },
          redo: async () => {
            await assignmentService.deleteAssignment(box.id);
            await refresh();
          },
        });
      }
    },
    [assignments, refresh, orgChartId],
  );

  return {
    assignments,
    loading,
    error,
    assignmentsOf,
    totalEtpOf,
    totalEtpReelOf,
    assignmentsOfClientMission,
    totalEtpOfClientMission,
    totalEtpReelOfClientMission,
    createAssignment,
    updateAssignmentEtpVendu,
    updateAssignmentEtpReel,
    updateAssignmentRemuneration,
    deleteAssignment,
  };
}
