import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as departmentService from '../services/departmentService';
import type { Department } from '../types/domain';

export function useDepartments() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDepartments(await departmentService.fetchDepartments());
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
      .channel(`departments-changes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => refresh())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  return {
    departments,
    loading,
    error,
    createDepartment: async (name: string) => {
      const created = await departmentService.createDepartment(name);
      await refresh();
      return created;
    },
    updateDepartment: async (id: string, name: string) => {
      await departmentService.updateDepartment(id, name);
      await refresh();
    },
    deleteDepartment: async (id: string) => {
      await departmentService.deleteDepartment(id);
      await refresh();
    },
  };
}
