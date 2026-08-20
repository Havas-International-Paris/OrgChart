import { useCallback, useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabaseClient';
import * as assignmentService from '../services/assignmentService';
import type { Assignment, RemunerationModel } from '../types/domain';
import { useHistoryStore } from '../stores/historyStore';

export function useAssignments(orgChartId: string | null) {
  const { t } = useTranslation();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
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
      const rows = await assignmentService.fetchAssignments(orgChartId);
      if (requestId !== latestRequestRef.current) return;
      setAssignments(rows);
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

  // Undo-only helper — see useEmployees.ts's restoreEmployee. Not recorded.
  const restoreAssignment = useCallback(
    async (row: Assignment): Promise<Assignment> => {
      const restored = await assignmentService.restoreAssignment(row);
      await refresh();
      return restored;
    },
    [refresh],
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
      useHistoryStore.getState().push({
        label: t('history.addAssignment'),
        orgChartId,
        undo: async () => {
          await assignmentService.deleteAssignment(created.id);
          await refresh();
        },
        redo: async () => {
          await assignmentService.restoreAssignment(created);
          await refresh();
        },
      });
      return created;
    },
    [refresh, orgChartId, t],
  );

  const updateAssignmentEtpVendu = useCallback(
    async (id: string, etpVendu: number | null) => {
      const before = assignments.find((a) => a.id === id);
      await assignmentService.updateAssignmentEtpVendu(id, etpVendu);
      await refresh();
      if (before && orgChartId) {
        const oldEtpVendu = before.etp_vendu;
        useHistoryStore.getState().push({
          label: t('history.updateEtpSold'),
          orgChartId,
          undo: async () => { await updateAssignmentEtpVendu(id, oldEtpVendu); },
          redo: async () => { await updateAssignmentEtpVendu(id, etpVendu); },
        });
      }
    },
    [assignments, refresh, orgChartId, t],
  );

  const updateAssignmentEtpVenduNextYear = useCallback(
    async (id: string, etpVenduNextYear: number | null) => {
      const before = assignments.find((a) => a.id === id);
      await assignmentService.updateAssignmentEtpVenduNextYear(id, etpVenduNextYear);
      await refresh();
      if (before && orgChartId) {
        const oldEtpVenduNextYear = before.etp_vendu_next_year;
        useHistoryStore.getState().push({
          label: t('history.updateEtpSoldNextYear'),
          orgChartId,
          undo: async () => { await updateAssignmentEtpVenduNextYear(id, oldEtpVenduNextYear); },
          redo: async () => { await updateAssignmentEtpVenduNextYear(id, etpVenduNextYear); },
        });
      }
    },
    [assignments, refresh, orgChartId, t],
  );

  const updateAssignmentRemunerationNextYear = useCallback(
    async (id: string, remunerationModelNextYear: RemunerationModel | null, clearVendu: boolean) => {
      const before = assignments.find((a) => a.id === id);
      await assignmentService.updateAssignmentRemunerationNextYear(id, remunerationModelNextYear, clearVendu);
      await refresh();
      if (before && orgChartId) {
        const oldModel = before.remuneration_model_next_year;
        const oldEtpVenduNextYear = before.etp_vendu_next_year;
        useHistoryStore.getState().push({
          label: t('history.updateRemunerationModelNextYear'),
          orgChartId,
          undo: async () => {
            await assignmentService.updateAssignmentRemunerationNextYear(id, oldModel, false);
            if (oldEtpVenduNextYear !== null) await assignmentService.updateAssignmentEtpVenduNextYear(id, oldEtpVenduNextYear);
            await refresh();
          },
          redo: async () => {
            await assignmentService.updateAssignmentRemunerationNextYear(id, remunerationModelNextYear, clearVendu);
            await refresh();
          },
        });
      }
    },
    [assignments, refresh, orgChartId, t],
  );

  const updateAssignmentEtpReel = useCallback(
    async (id: string, etpReel: number | null) => {
      const before = assignments.find((a) => a.id === id);
      await assignmentService.updateAssignmentEtpReel(id, etpReel);
      await refresh();
      if (before && orgChartId) {
        const oldEtpReel = before.etp_reel;
        useHistoryStore.getState().push({
          label: t('history.updateEtpActual'),
          orgChartId,
          undo: async () => { await updateAssignmentEtpReel(id, oldEtpReel); },
          redo: async () => { await updateAssignmentEtpReel(id, etpReel); },
        });
      }
    },
    [assignments, refresh, orgChartId, t],
  );

  const updateAssignmentRemuneration = useCallback(
    async (id: string, remunerationModel: RemunerationModel | null, clearVendu: boolean) => {
      const before = assignments.find((a) => a.id === id);
      await assignmentService.updateAssignmentRemuneration(id, remunerationModel, clearVendu);
      await refresh();
      if (before && orgChartId) {
        const oldModel = before.remuneration_model;
        const oldEtpVendu = before.etp_vendu;
        useHistoryStore.getState().push({
          label: t('history.updateRemunerationModel'),
          orgChartId,
          undo: async () => {
            await assignmentService.updateAssignmentRemuneration(id, oldModel, false);
            if (oldEtpVendu !== null) await assignmentService.updateAssignmentEtpVendu(id, oldEtpVendu);
            await refresh();
          },
          redo: async () => {
            await assignmentService.updateAssignmentRemuneration(id, remunerationModel, clearVendu);
            await refresh();
          },
        });
      }
    },
    [assignments, refresh, orgChartId, t],
  );

  const deleteAssignment = useCallback(
    async (id: string) => {
      const before = assignments.find((a) => a.id === id);
      await assignmentService.deleteAssignment(id);
      await refresh();
      if (before && orgChartId) {
        useHistoryStore.getState().push({
          label: t('history.deleteAssignment'),
          orgChartId,
          undo: async () => {
            await assignmentService.restoreAssignment(before);
            await refresh();
          },
          redo: async () => {
            await assignmentService.deleteAssignment(id);
            await refresh();
          },
        });
      }
    },
    [assignments, refresh, orgChartId, t],
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
    restoreAssignment,
    updateAssignmentEtpVendu,
    updateAssignmentEtpReel,
    updateAssignmentRemuneration,
    updateAssignmentEtpVenduNextYear,
    updateAssignmentRemunerationNextYear,
    deleteAssignment,
  };
}
