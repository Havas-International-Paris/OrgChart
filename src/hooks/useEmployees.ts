import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as employeeService from '../services/employeeService';
import type { Employee, EmployeeInput, PhotoFrameValues } from '../types/domain';

export function useEmployees(orgChartId: string | null) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!orgChartId) return;
    try {
      setEmployees(await employeeService.fetchEmployees(orgChartId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgChartId]);

  useEffect(() => {
    if (!orgChartId) return;
    // Reset to a clean loading state before fetching the new chart's data,
    // so consumers see a real loading:true→false transition on every switch
    // instead of briefly showing the previous chart's stale employees.
    setEmployees([]);
    setLoading(true);
    refresh();

    // Unique per mount: this hook can have multiple simultaneous consumers
    // (grid + chart), and React StrictMode double-mounts in dev — a shared
    // fixed channel name would collide with `.on()` after `.subscribe()`.
    // Deliberately unfiltered (not `filter: org_chart_id=eq.${orgChartId}`):
    // Postgres only ships primary-key columns in a DELETE's WAL entry under
    // the default replica identity, so Realtime can't evaluate a filter on
    // a non-PK column like org_chart_id for DELETE events and silently
    // drops them for filtered subscribers — INSERT/UPDATE were never
    // affected since the full new row is always available. Subscribing
    // unfiltered and re-scoping via the (already org_chart_id-filtered)
    // refresh() query sidesteps that Realtime limitation entirely, at the
    // cost of an occasional harmless refetch triggered by another chart's
    // change — fine at this app's scale (a few hundred rows).
    const channel = supabase
      .channel(`employees-changes-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'employees' },
        () => {
          refresh();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgChartId, refresh]);

  return {
    employees,
    loading,
    error,
    createEmployee: async (input: EmployeeInput) => {
      if (!orgChartId) throw new Error('No active org chart');
      const created = await employeeService.createEmployee(orgChartId, input);
      await refresh();
      return created;
    },
    updateEmployee: async (id: string, changes: Partial<EmployeeInput>) => {
      const updated = await employeeService.updateEmployee(id, changes);
      await refresh();
      return updated;
    },
    deleteEmployee: async (id: string) => {
      await employeeService.deleteEmployee(id);
      await refresh();
    },
    updateEmployeePhoto: async (id: string, photoPath: string | null) => {
      const updated = await employeeService.updateEmployeePhoto(id, photoPath);
      await refresh();
      return updated;
    },
    updateEmployeePhotoFrame: async (id: string, frame: PhotoFrameValues) => {
      const updated = await employeeService.updateEmployeePhotoFrame(id, frame);
      await refresh();
      return updated;
    },
  };
}
