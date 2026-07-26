import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as departmentService from '../services/departmentService';
import type { Department } from '../types/domain';
import { useHistoryStore } from '../stores/historyStore';
import { useSelectionStore } from '../stores/selectionStore';

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

  const createDepartment = async (name: string) => {
    const created = await departmentService.createDepartment(name);
    await refresh();
    const orgChartId = useSelectionStore.getState().currentOrgChartId;
    if (orgChartId) {
      useHistoryStore.getState().push({
        label: `Créer la business unit ${created.name}`,
        orgChartId,
        undo: async () => {
          await departmentService.deleteDepartment(created.id);
          await refresh();
        },
        redo: async () => {
          await departmentService.restoreDepartment(created);
          await refresh();
        },
      });
    }
    return created;
  };

  // oldNameHint: AG Grid mutates its row data object in place before firing
  // onCellValueChanged (see useEmployees.ts's updateEmployee), so
  // DepartmentsGrid passes the event's real oldValue rather than letting
  // this fall back to departments.find(id), which can no longer be trusted
  // by then.
  const updateDepartment = async (id: string, name: string, oldNameHint?: string) => {
    const before = departments.find((d) => d.id === id);
    await departmentService.updateDepartment(id, name);
    await refresh();
    const orgChartId = useSelectionStore.getState().currentOrgChartId;
    if (before && orgChartId) {
      const oldName = oldNameHint ?? before.name;
      useHistoryStore.getState().push({
        label: `Renommer la business unit ${oldName}`,
        orgChartId,
        undo: async () => { await updateDepartment(id, oldName); },
        redo: async () => { await updateDepartment(id, name); },
      });
    }
  };

  const deleteDepartment = async (id: string) => {
    const before = departments.find((d) => d.id === id);
    await departmentService.deleteDepartment(id);
    await refresh();
    const orgChartId = useSelectionStore.getState().currentOrgChartId;
    if (before && orgChartId) {
      useHistoryStore.getState().push({
        label: `Supprimer la business unit ${before.name}`,
        orgChartId,
        undo: async () => {
          await departmentService.restoreDepartment(before);
          await refresh();
        },
        redo: async () => {
          await departmentService.deleteDepartment(id);
          await refresh();
        },
      });
    }
  };

  return {
    departments,
    loading,
    error,
    createDepartment,
    updateDepartment,
    deleteDepartment,
  };
}
