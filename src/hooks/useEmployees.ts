import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as employeeService from '../services/employeeService';
import type { Employee, EmployeeInput } from '../types/domain';

export function useEmployees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEmployees(await employeeService.fetchEmployees());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    // Unique per mount: this hook can have multiple simultaneous consumers
    // (grid + chart), and React StrictMode double-mounts in dev — a shared
    // fixed channel name would collide with `.on()` after `.subscribe()`.
    const channel = supabase
      .channel(`employees-changes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => {
        refresh();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  return {
    employees,
    loading,
    error,
    createEmployee: async (input: EmployeeInput) => {
      const created = await employeeService.createEmployee(input);
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
