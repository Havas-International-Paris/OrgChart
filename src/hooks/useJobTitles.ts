import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as jobTitleService from '../services/jobTitleService';
import type { JobTitle } from '../types/domain';

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

  return {
    jobTitles,
    loading,
    error,
    createJobTitle: async (name: string) => {
      const created = await jobTitleService.createJobTitle(name);
      await refresh();
      return created;
    },
    updateJobTitle: async (id: string, name: string) => {
      await jobTitleService.updateJobTitle(id, name);
      await refresh();
    },
    deleteJobTitle: async (id: string) => {
      await jobTitleService.deleteJobTitle(id);
      await refresh();
    },
  };
}
