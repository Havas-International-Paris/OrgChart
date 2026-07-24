import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as jobTitleService from '../services/jobTitleService';
import type { JobTitle } from '../types/domain';
import { useHistoryStore } from '../stores/historyStore';
import { boxFor } from '../stores/idRegistryStore';
import { useSelectionStore } from '../stores/selectionStore';

export function useJobTitles() {
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setJobTitles(await jobTitleService.fetchJobTitles());
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
      .channel(`job-titles-changes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_titles' }, () => refresh())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const createJobTitle = async (name: string) => {
    const created = await jobTitleService.createJobTitle(name);
    await refresh();
    const orgChartId = useSelectionStore.getState().currentOrgChartId;
    const box = boxFor(created.id);
    if (orgChartId) {
      useHistoryStore.getState().push({
        label: `Créer le poste ${created.name}`,
        orgChartId,
        undo: async () => {
          await jobTitleService.deleteJobTitle(box.id);
          await refresh();
        },
        redo: async () => {
          const recreated = await jobTitleService.createJobTitle(name);
          box.id = recreated.id;
          await refresh();
        },
      });
    }
    return created;
  };

  // oldNameHint: AG Grid mutates its row data object in place before firing
  // onCellValueChanged (see useEmployees.ts's updateEmployee), so
  // JobTitlesGrid passes the event's real oldValue rather than letting this
  // fall back to jobTitles.find(id), which can no longer be trusted by then.
  const updateJobTitle = async (id: string, name: string, oldNameHint?: string) => {
    const before = jobTitles.find((jt) => jt.id === id);
    await jobTitleService.updateJobTitle(id, name);
    await refresh();
    const orgChartId = useSelectionStore.getState().currentOrgChartId;
    if (before && orgChartId) {
      const box = boxFor(id);
      const oldName = oldNameHint ?? before.name;
      useHistoryStore.getState().push({
        label: `Renommer le poste ${oldName}`,
        orgChartId,
        undo: async () => { await updateJobTitle(box.id, oldName); },
        redo: async () => { await updateJobTitle(box.id, name); },
      });
    }
  };

  const deleteJobTitle = async (id: string) => {
    const before = jobTitles.find((jt) => jt.id === id);
    await jobTitleService.deleteJobTitle(id);
    await refresh();
    const orgChartId = useSelectionStore.getState().currentOrgChartId;
    if (before && orgChartId) {
      const box = boxFor(id);
      useHistoryStore.getState().push({
        label: `Supprimer le poste ${before.name}`,
        orgChartId,
        undo: async () => {
          const recreated = await jobTitleService.createJobTitle(before.name);
          box.id = recreated.id;
          await refresh();
        },
        redo: async () => {
          await jobTitleService.deleteJobTitle(box.id);
          await refresh();
        },
      });
    }
  };

  return {
    jobTitles,
    loading,
    error,
    createJobTitle,
    updateJobTitle,
    deleteJobTitle,
  };
}
