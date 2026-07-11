import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as assignmentService from '../services/assignmentService';
import type { Assignment } from '../types/domain';

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
    (employeeId: string) => assignmentsOf(employeeId).reduce((sum, a) => sum + a.etp_percent, 0),
    [assignmentsOf],
  );

  const createAssignment = useCallback(
    async (employeeId: string, clientMissionId: string, etpPercent: number) => {
      await assignmentService.createAssignment(employeeId, clientMissionId, etpPercent);
      await refresh();
    },
    [refresh],
  );

  const updateAssignmentEtp = useCallback(
    async (id: string, etpPercent: number) => {
      await assignmentService.updateAssignmentEtp(id, etpPercent);
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
    createAssignment,
    updateAssignmentEtp,
    deleteAssignment,
  };
}
