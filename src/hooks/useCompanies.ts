import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabaseClient';
import * as companyService from '../services/companyService';
import type { Company } from '../types/domain';
import { useHistoryStore } from '../stores/historyStore';
import { useSelectionStore } from '../stores/selectionStore';

export function useCompanies() {
  const { t } = useTranslation();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCompanies(await companyService.fetchCompanies());
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
      .channel(`companies-changes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'companies' }, () => refresh())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const createCompany = async (name: string) => {
    const created = await companyService.createCompany(name);
    await refresh();
    const orgChartId = useSelectionStore.getState().currentOrgChartId;
    if (orgChartId) {
      useHistoryStore.getState().push({
        label: t('history.createCompany', { name: created.name }),
        orgChartId,
        undo: async () => {
          await companyService.deleteCompany(created.id);
          await refresh();
        },
        redo: async () => {
          await companyService.restoreCompany(created);
          await refresh();
        },
      });
    }
    return created;
  };

  // oldNameHint lets a caller pass the pre-edit value explicitly rather than
  // relying on companies.find(id), in case its own local state has already
  // moved on by the time this runs.
  const updateCompany = async (id: string, name: string, oldNameHint?: string) => {
    const before = companies.find((c) => c.id === id);
    await companyService.updateCompany(id, name);
    await refresh();
    const orgChartId = useSelectionStore.getState().currentOrgChartId;
    if (before && orgChartId) {
      const oldName = oldNameHint ?? before.name;
      useHistoryStore.getState().push({
        label: t('history.renameCompany', { name: oldName }),
        orgChartId,
        undo: async () => { await updateCompany(id, oldName); },
        redo: async () => { await updateCompany(id, name); },
      });
    }
  };

  const updateCompanyColor = async (id: string, color: string | null) => {
    const before = companies.find((c) => c.id === id);
    await companyService.updateCompanyColor(id, color);
    await refresh();
    const orgChartId = useSelectionStore.getState().currentOrgChartId;
    if (before && orgChartId) {
      const oldColor = before.color;
      useHistoryStore.getState().push({
        label: t('history.changeCompanyColor', { name: before.name }),
        orgChartId,
        undo: async () => { await updateCompanyColor(id, oldColor); },
        redo: async () => { await updateCompanyColor(id, color); },
      });
    }
  };

  const deleteCompany = async (id: string) => {
    const before = companies.find((c) => c.id === id);
    await companyService.deleteCompany(id);
    await refresh();
    const orgChartId = useSelectionStore.getState().currentOrgChartId;
    if (before && orgChartId) {
      useHistoryStore.getState().push({
        label: t('history.deleteCompany', { name: before.name }),
        orgChartId,
        undo: async () => {
          await companyService.restoreCompany(before);
          await refresh();
        },
        redo: async () => {
          await companyService.deleteCompany(id);
          await refresh();
        },
      });
    }
  };

  return {
    companies,
    loading,
    error,
    createCompany,
    updateCompany,
    updateCompanyColor,
    deleteCompany,
  };
}
