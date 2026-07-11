import { useState } from 'react';
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
  const [query, setQuery] = useState('');
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const filtered = candidates.filter((c) =>
    `${c.first_name} ${c.last_name}`.toLowerCase().includes(query.toLowerCase()),
  );

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
          placeholder="Rechercher…"
          autoFocus
          className="mb-3 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
        <div className="max-h-72 space-y-1 overflow-auto">
          {filtered.length === 0 && (
            <p className="px-2 py-1 text-sm text-slate-400">Aucun employé disponible.</p>
          )}
          {filtered.map((candidate) => {
            const disabled = isDisabled(candidate.id);
            return (
              <button
                key={candidate.id}
                disabled={disabled || linkingId !== null}
                onClick={() => handleLink(candidate.id)}
                title={disabled ? 'Créerait une boucle de reporting' : undefined}
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
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
