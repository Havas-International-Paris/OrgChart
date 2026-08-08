import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Employee } from '../../types/domain';

interface LinkExistingEmployeeModalProps {
  title: string;
  candidates: Employee[];
  isDisabled: (candidateId: string) => boolean;
  onLink: (candidateId: string) => Promise<void>;
  onClose: () => void;
}

export function LinkExistingEmployeeModal({
  title,
  candidates,
  isDisabled,
  onLink,
  onClose,
}: LinkExistingEmployeeModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'first_name' | 'last_name' | 'job_title'>('first_name');

  const normalizedQuery = query.toLowerCase();
  const filtered = candidates
    .filter((c) =>
      `${c.first_name} ${c.last_name} ${c.job_title ?? ''}`.toLowerCase().includes(normalizedQuery),
    )
    .sort((a, b) => {
      const aValue = (sortBy === 'job_title' ? a.job_title : a[sortBy]) ?? '';
      const bValue = (sortBy === 'job_title' ? b.job_title : b[sortBy]) ?? '';
      return aValue.localeCompare(bValue);
    });

  async function handleLink(id: string) {
    setLinkingId(id);
    try {
      await onLink(id);
      onClose();
    } finally {
      setLinkingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('modals.linkExisting.searchPlaceholder')}
          autoFocus
          className="mb-2 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
        <div className="mb-3 flex items-center gap-2">
          <label htmlFor="link-existing-sort" className="text-xs text-slate-500">
            {t('modals.linkExisting.sortBy')}
          </label>
          <select
            id="link-existing-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
          >
            <option value="first_name">{t('modals.linkExisting.sortFirstName')}</option>
            <option value="last_name">{t('modals.linkExisting.sortLastName')}</option>
            <option value="job_title">{t('modals.linkExisting.sortJobTitle')}</option>
          </select>
        </div>
        <div className="max-h-72 space-y-1 overflow-auto">
          {filtered.length === 0 && (
            <p className="px-2 py-1 text-sm text-slate-400">{t('modals.linkExisting.empty')}</p>
          )}
          {filtered.map((candidate) => {
            const disabled = isDisabled(candidate.id);
            return (
              <button
                key={candidate.id}
                disabled={disabled || linkingId !== null}
                onClick={() => handleLink(candidate.id)}
                title={disabled ? t('modals.linkExisting.wouldCreateCycle') : undefined}
                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm ${
                  disabled ? 'cursor-not-allowed text-slate-300' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>
                  {candidate.first_name} {candidate.last_name}
                  {candidate.job_title ? ` — ${candidate.job_title}` : ''}
                </span>
                {linkingId === candidate.id && <span className="text-xs text-slate-400">…</span>}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
          >
            {t('modals.linkExisting.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
