import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as employeeService from '../services/employeeService';
import type { Employee, EmployeeInput } from '../types/domain';

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
    const channel = supabase
      .channel(`employees-changes-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'employees', filter: `org_chart_id=eq.${orgChartId}` },
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
  };
}
