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

  // oldNameHint lets a caller pass the pre-edit value explicitly rather than
  // relying on departments.find(id), in case its own local state has already
  // moved on by the time this runs.
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

  const updateDepartmentColor = async (id: string, color: string | null) => {
    const before = departments.find((d) => d.id === id);
    await departmentService.updateDepartmentColor(id, color);
    await refresh();
    const orgChartId = useSelectionStore.getState().currentOrgChartId;
    if (before && orgChartId) {
      const oldColor = before.color;
      useHistoryStore.getState().push({
        label: `Changer la couleur de ${before.name}`,
        orgChartId,
        undo: async () => { await updateDepartmentColor(id, oldColor); },
        redo: async () => { await updateDepartmentColor(id, color); },
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
    updateDepartmentColor,
    deleteDepartment,
  };
}
