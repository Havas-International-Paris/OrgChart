import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as assignmentService from '../services/assignmentService';
import type { Assignment, RemunerationModel } from '../types/domain';

export function useAssignments() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setAssignments(await assignmentService.fetchAssignments());
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
      .channel(`assignments-changes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, () => refresh())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const assignmentsOf = useCallback(
    (employeeId: string) => assignments.filter((a) => a.employee_id === employeeId),
    [assignments],
  );

  const totalEtpOf = useCallback(
    (employeeId: string) => assignmentsOf(employeeId).reduce((sum, a) => sum + (a.etp_vendu ?? 0), 0),
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
      await assignmentService.createAssignment(employeeId, clientMissionId, etpVendu, etpReel, remunerationModel);
      await refresh();
    },
    [refresh],
  );

  const updateAssignmentEtpVendu = useCallback(
    async (id: string, etpVendu: number | null) => {
      await assignmentService.updateAssignmentEtpVendu(id, etpVendu);
      await refresh();
    },
    [refresh],
  );

  const updateAssignmentEtpReel = useCallback(
    async (id: string, etpReel: number | null) => {
      await assignmentService.updateAssignmentEtpReel(id, etpReel);
      await refresh();
    },
    [refresh],
  );

  const updateAssignmentRemuneration = useCallback(
    async (id: string, remunerationModel: RemunerationModel | null, clearVendu: boolean) => {
      await assignmentService.updateAssignmentRemuneration(id, remunerationModel, clearVendu);
      await refresh();
    },
    [refresh],
  );

  const deleteAssignment = useCallback(
    async (id: string) => {
      await assignmentService.deleteAssignment(id);
      await refresh();
    },
    [refresh],
  );

  return {
    assignments,
    loading,
    error,
    assignmentsOf,
    totalEtpOf,
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
