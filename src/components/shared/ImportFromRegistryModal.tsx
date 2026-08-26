import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEmployees } from '../../hooks/useEmployees';

interface ImportFromRegistryModalProps {
  registryChartId: string;
  onImport: (selectedEmployeeIds: string[], includeAssignments: boolean) => Promise<void>;
  onClose: () => void;
}

// Multi-select sibling of LinkExistingEmployeeModal.tsx — that one links ONE
// candidate immediately on click; this one needs a whole selection plus an
// options checkbox before a single confirm action, so it can't reuse the
// same click-to-commit interaction shape even though the visual language
// (search box, scrollable candidate list) matches.
export function ImportFromRegistryModal({ registryChartId, onImport, onClose }: ImportFromRegistryModalProps) {
  const { t } = useTranslation();
  const { employees: registryEmployees, loading } = useEmployees(registryChartId);
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [includeAssignments, setIncludeAssignments] = useState(false);
  const [importing, setImporting] = useState(false);

  // Hard-excludes departed employees regardless of the "hide departed"
  // toggle — importing someone who's left the company into a working chart
  // never makes sense, unlike simply seeing them listed elsewhere.
  const filtered = registryEmployees.filter((c) => {
    if (c.has_left_company) return false;
    const haystack = `${c.first_name} ${c.last_name} ${c.job_title ?? ''} ${c.department ?? ''}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirm() {
    setImporting(true);
    try {
      await onImport([...selectedIds], includeAssignments);
      onClose();
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('modals.importFromRegistry.title')}</h2>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('modals.importFromRegistry.searchPlaceholder')}
          autoFocus
          className="mb-3 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
        <div className="max-h-72 space-y-1 overflow-auto">
          {!loading && filtered.length === 0 && (
            <p className="px-2 py-1 text-sm text-slate-400">{t('modals.importFromRegistry.empty')}</p>
          )}
          {filtered.map((candidate) => (
            <label
              key={candidate.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(candidate.id)}
                onChange={() => toggle(candidate.id)}
                className="shrink-0"
              />
              <span>
                {candidate.first_name} {candidate.last_name}
                {candidate.job_title ? ` — ${candidate.job_title}` : ''}
              </span>
            </label>
          ))}
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={includeAssignments}
            onChange={(e) => setIncludeAssignments(e.target.checked)}
          />
          {t('modals.importFromRegistry.includeAssignments')}
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
            {t('modals.importFromRegistry.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={selectedIds.size === 0 || importing}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {importing
              ? t('modals.importFromRegistry.importing')
              : t('modals.importFromRegistry.confirm', { count: selectedIds.size })}
          </button>
        </div>
      </div>
    </div>
  );
}
