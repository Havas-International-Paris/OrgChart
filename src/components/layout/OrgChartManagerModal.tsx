import { useState } from 'react';
import type { OrgChart } from '../../types/domain';

interface OrgChartManagerModalProps {
  orgCharts: OrgChart[];
  currentOrgChartId: string;
  onCreate: (name: string, shortLabel: string) => Promise<void>;
  onRename: (id: string, changes: { name?: string; short_label?: string }) => Promise<void>;
  onDuplicate: (sourceId: string, newName: string, newShortLabel: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

const SECTION_TITLE_CLASS = 'mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400';
const SECTION_ROW_CLASS = 'flex items-end gap-2 rounded border border-slate-200 p-3';
const FIELD_INPUT_CLASS = 'w-full rounded border border-slate-300 px-2 py-1 text-sm';
const FIELD_LABEL_CLASS = 'mb-1 block text-xs text-slate-500';

export function OrgChartManagerModal({
  orgCharts,
  currentOrgChartId,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  onClose,
}: OrgChartManagerModalProps) {
  const [newName, setNewName] = useState('');
  const [newShortLabel, setNewShortLabel] = useState('');
  const [creating, setCreating] = useState(false);

  const initialSourceId = currentOrgChartId || orgCharts[0]?.id || '';
  const initialSource = orgCharts.find((c) => c.id === initialSourceId);
  const [dupSourceId, setDupSourceId] = useState(initialSourceId);
  const [dupName, setDupName] = useState(initialSource ? `Copie de ${initialSource.name}` : '');
  const [dupShortLabel, setDupShortLabel] = useState(initialSource?.short_label ?? '');
  const [duplicating, setDuplicating] = useState(false);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await onCreate(newName.trim(), newShortLabel.trim());
      setNewName('');
      setNewShortLabel('');
    } finally {
      setCreating(false);
    }
  }

  function handleSourceChange(id: string) {
    setDupSourceId(id);
    const source = orgCharts.find((c) => c.id === id);
    if (source) {
      setDupName(`Copie de ${source.name}`);
      setDupShortLabel(source.short_label);
    }
  }

  async function handleDuplicate() {
    if (!dupSourceId || !dupName.trim()) return;
    setDuplicating(true);
    try {
      await onDuplicate(dupSourceId, dupName.trim(), dupShortLabel.trim());
    } finally {
      setDuplicating(false);
    }
  }

  return (
    <div data-row-stabilizer-ignore className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-lg">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Organigrammes</h2>

        <section className="mb-4">
          <h3 className={SECTION_TITLE_CLASS}>Nouvel organigramme (vide)</h3>
          <div className={SECTION_ROW_CLASS}>
            <div className="flex-1">
              <label className={FIELD_LABEL_CLASS}>Nom</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nouvel organigramme"
                className={FIELD_INPUT_CLASS}
              />
            </div>
            <div className="w-28">
              <label className={FIELD_LABEL_CLASS}>Libellé court</label>
              <input
                value={newShortLabel}
                onChange={(e) => setNewShortLabel(e.target.value)}
                className={FIELD_INPUT_CLASS}
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {creating ? 'Création…' : 'Créer'}
            </button>
          </div>
        </section>

        <section className="mb-4">
          <h3 className={SECTION_TITLE_CLASS}>Dupliquer un organigramme existant</h3>
          <div className="space-y-2 rounded border border-slate-200 p-3">
            <div>
              <label className={FIELD_LABEL_CLASS}>Organigramme à dupliquer</label>
              <select
                value={dupSourceId}
                onChange={(e) => handleSourceChange(e.target.value)}
                className={FIELD_INPUT_CLASS}
              >
                {orgCharts.map((chart) => (
                  <option key={chart.id} value={chart.id}>
                    {chart.short_label ? `${chart.name} – ${chart.short_label}` : chart.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className={FIELD_LABEL_CLASS}>Nom de la copie</label>
                <input
                  value={dupName}
                  onChange={(e) => setDupName(e.target.value)}
                  className={FIELD_INPUT_CLASS}
                />
              </div>
              <div className="w-28">
                <label className={FIELD_LABEL_CLASS}>Libellé court</label>
                <input
                  value={dupShortLabel}
                  onChange={(e) => setDupShortLabel(e.target.value)}
                  className={FIELD_INPUT_CLASS}
                />
              </div>
              <button
                onClick={handleDuplicate}
                disabled={duplicating || !dupSourceId || !dupName.trim()}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {duplicating ? 'Duplication…' : 'Dupliquer'}
              </button>
            </div>
          </div>
        </section>

        <section>
          <h3 className={SECTION_TITLE_CLASS}>Organigrammes existants</h3>
          <div className="max-h-72 space-y-2 overflow-auto">
            {orgCharts.map((chart) => (
              <OrgChartRow
                key={chart.id}
                chart={chart}
                canDelete={orgCharts.length > 1}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))}
          </div>
        </section>

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

interface OrgChartRowProps {
  chart: OrgChart;
  canDelete: boolean;
  onRename: (id: string, changes: { name?: string; short_label?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function OrgChartRow({ chart, canDelete, onRename, onDelete }: OrgChartRowProps) {
  const [name, setName] = useState(chart.name);
  const [shortLabel, setShortLabel] = useState(chart.short_label);
  const [savingRename, setSavingRename] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty = name !== chart.name || shortLabel !== chart.short_label;

  async function handleSaveRename() {
    setSavingRename(true);
    try {
      await onRename(chart.id, { name, short_label: shortLabel });
    } finally {
      setSavingRename(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Supprimer définitivement « ${chart.name} » et toutes ses données (employés, rattachements, missions) ? Cette action est irréversible.`)) {
      return;
    }
    setDeleting(true);
    try {
      await onDelete(chart.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="rounded border border-slate-200 p-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className={FIELD_LABEL_CLASS}>Nom</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </div>
        <div className="w-28">
          <label className={FIELD_LABEL_CLASS}>Libellé court</label>
          <input
            value={shortLabel}
            onChange={(e) => setShortLabel(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </div>
        {dirty && (
          <button
            onClick={handleSaveRename}
            disabled={savingRename}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {savingRename ? '…' : 'Enregistrer'}
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={!canDelete || deleting}
          title={!canDelete ? 'Impossible de supprimer le dernier organigramme' : undefined}
          className="rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-30"
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}
