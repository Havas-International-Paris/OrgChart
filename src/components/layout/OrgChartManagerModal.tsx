import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToastStore } from '../../stores/toastStore';
import { useOrgChartAccess } from '../../hooks/useOrgChartAccess';
import { PermissionDeniedError } from '../../lib/mutationGuard';
import type { OrgChart, OrgChartAccessRole, OrgChartVisibility, UserRoleName } from '../../types/domain';

interface OrgChartManagerModalProps {
  orgCharts: OrgChart[];
  currentOrgChartId: string;
  currentUserId: string;
  currentUserRole: UserRoleName | null;
  onCreate: (name: string, shortLabel: string) => Promise<void>;
  onRename: (id: string, changes: { name?: string; short_label?: string; visibility?: OrgChartVisibility }) => Promise<void>;
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
  currentUserId,
  currentUserRole,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  onClose,
}: OrgChartManagerModalProps) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState('');
  const [newShortLabel, setNewShortLabel] = useState('');
  const [creating, setCreating] = useState(false);

  const initialSourceId = currentOrgChartId || orgCharts[0]?.id || '';
  const initialSource = orgCharts.find((c) => c.id === initialSourceId);
  const [dupSourceId, setDupSourceId] = useState(initialSourceId);
  const [dupName, setDupName] = useState(initialSource ? t('orgChartManager.copyOf', { name: initialSource.name }) : '');
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
      setDupName(t('orgChartManager.copyOf', { name: source.name }));
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-lg">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">{t('orgChartManager.title')}</h2>

        <section className="mb-4">
          <h3 className={SECTION_TITLE_CLASS}>{t('orgChartManager.newChart')}</h3>
          <div className={SECTION_ROW_CLASS}>
            <div className="flex-1">
              <label className={FIELD_LABEL_CLASS}>{t('orgChartManager.name')}</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('orgChartManager.namePlaceholder')}
                className={FIELD_INPUT_CLASS}
              />
            </div>
            <div className="w-28">
              <label className={FIELD_LABEL_CLASS}>{t('orgChartManager.shortLabel')}</label>
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
              {creating ? t('orgChartManager.creating') : t('orgChartManager.create')}
            </button>
          </div>
        </section>

        <section className="mb-4">
          <h3 className={SECTION_TITLE_CLASS}>{t('orgChartManager.duplicateExisting')}</h3>
          <div className="space-y-2 rounded border border-slate-200 p-3">
            <div>
              <label className={FIELD_LABEL_CLASS}>{t('orgChartManager.chartToDuplicate')}</label>
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
                <label className={FIELD_LABEL_CLASS}>{t('orgChartManager.copyName')}</label>
                <input
                  value={dupName}
                  onChange={(e) => setDupName(e.target.value)}
                  className={FIELD_INPUT_CLASS}
                />
              </div>
              <div className="w-28">
                <label className={FIELD_LABEL_CLASS}>{t('orgChartManager.shortLabel')}</label>
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
                {duplicating ? t('orgChartManager.duplicating') : t('orgChartManager.duplicate')}
              </button>
            </div>
          </div>
        </section>

        <section>
          <h3 className={SECTION_TITLE_CLASS}>{t('orgChartManager.existingCharts')}</h3>
          <div className="max-h-72 space-y-2 overflow-auto">
            {orgCharts.map((chart) => (
              <OrgChartRow
                key={chart.id}
                chart={chart}
                canDelete={orgCharts.length > 1}
                canManageSharing={
                  currentUserRole === 'admin' || chart.created_by === currentUserId
                }
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
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface OrgChartRowProps {
  chart: OrgChart;
  canDelete: boolean;
  canManageSharing: boolean;
  onRename: (id: string, changes: { name?: string; short_label?: string; visibility?: OrgChartVisibility }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function OrgChartRow({ chart, canDelete, canManageSharing, onRename, onDelete }: OrgChartRowProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(chart.name);
  const [shortLabel, setShortLabel] = useState(chart.short_label);
  const [savingRename, setSavingRename] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [changingVisibility, setChangingVisibility] = useState(false);
  const [sharing, setSharing] = useState(false);

  const dirty = name !== chart.name || shortLabel !== chart.short_label;

  async function handleSaveRename() {
    setSavingRename(true);
    try {
      await onRename(chart.id, { name, short_label: shortLabel });
    } finally {
      setSavingRename(false);
    }
  }

  async function handleVisibilityChange(visibility: OrgChartVisibility) {
    setChangingVisibility(true);
    try {
      await onRename(chart.id, { visibility });
    } catch (err) {
      const message =
        err instanceof PermissionDeniedError ? t('errors.permissionDenied') : t('orgChartManager.deleteFailed');
      useToastStore.getState().show({ message });
    } finally {
      setChangingVisibility(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(t('orgChartManager.deleteConfirm', { name: chart.name }))) {
      return;
    }
    setDeleting(true);
    try {
      await onDelete(chart.id);
    } catch (err) {
      // Surfaces what used to be a silent no-op: RLS denies a delete by
      // simply matching zero rows, not by throwing — mutationGuard's
      // assertRowsAffected (used by every service's UPDATE/DELETE) turns
      // that into a PermissionDeniedError specifically so this has
      // something to catch. Any OTHER error still gets a message, just a
      // more generic one — this isn't meant to swallow real failures.
      const message =
        err instanceof PermissionDeniedError
          ? t('orgChartManager.deleteNotPermitted')
          : t('orgChartManager.deleteFailed');
      useToastStore.getState().show({ message });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="rounded border border-slate-200 p-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className={FIELD_LABEL_CLASS}>{t('orgChartManager.name')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </div>
        <div className="w-28">
          <label className={FIELD_LABEL_CLASS}>{t('orgChartManager.shortLabel')}</label>
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
            {savingRename ? t('orgChartManager.saving') : t('common.save')}
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={!canDelete || deleting}
          title={!canDelete ? t('orgChartManager.cannotDeleteLast') : undefined}
          className="rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-30"
        >
          {t('common.delete')}
        </button>
      </div>

      {canManageSharing && (
        <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2">
          <label className="text-xs text-slate-500">{t('orgChartManager.visibility')}</label>
          <select
            value={chart.visibility}
            disabled={changingVisibility}
            onChange={(e) => handleVisibilityChange(e.target.value as OrgChartVisibility)}
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="private">{t('orgChartManager.visibilityPrivate')}</option>
            <option value="public">{t('orgChartManager.visibilityPublic')}</option>
          </select>
          <button
            onClick={() => setSharing((s) => !s)}
            className="ml-auto rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {t('orgChartManager.share')}
          </button>
        </div>
      )}

      {canManageSharing && sharing && <SharingPanel orgChartId={chart.id} />}
    </div>
  );
}

const ROLE_OPTIONS: OrgChartAccessRole[] = ['lecteur', 'editeur'];

function SharingPanel({ orgChartId }: { orgChartId: string }) {
  const { t } = useTranslation();
  const { access, activeUsers, loading, grantAccess, revokeAccess } = useOrgChartAccess(orgChartId);
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState<OrgChartAccessRole>('lecteur');
  const [adding, setAdding] = useState(false);

  const emailOf = useMemo(() => {
    const map = new Map(activeUsers.map((u) => [u.user_id, u.email]));
    return (userId: string) => map.get(userId) ?? userId;
  }, [activeUsers]);

  const grantedIds = useMemo(() => new Set(access.map((a) => a.user_id)), [access]);
  const candidates = activeUsers.filter((u) => !grantedIds.has(u.user_id));

  async function handleAdd() {
    if (!addUserId) return;
    setAdding(true);
    try {
      await grantAccess(addUserId, addRole);
      setAddUserId('');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="mt-2 rounded border border-slate-100 bg-slate-50 p-2">
      {loading ? (
        <p className="text-xs text-slate-400">{t('access.loading')}</p>
      ) : (
        <>
          {access.length === 0 ? (
            <p className="mb-2 text-xs text-slate-400">{t('orgChartManager.sharedWithNoOne')}</p>
          ) : (
            <ul className="mb-2 space-y-1">
              {access.map((row) => (
                <li key={row.user_id} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 truncate text-slate-700">{emailOf(row.user_id)}</span>
                  <select
                    value={row.role}
                    onChange={(e) => grantAccess(row.user_id, e.target.value as OrgChartAccessRole)}
                    className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {t(`access.roles.${role}`)}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => revokeAccess(row.user_id)}
                    className="text-red-600 hover:underline"
                  >
                    {t('orgChartManager.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {candidates.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={addUserId}
                onChange={(e) => setAddUserId(e.target.value)}
                className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-0.5 text-xs"
              >
                <option value="">{t('orgChartManager.addUserPlaceholder')}</option>
                {candidates.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.email}
                  </option>
                ))}
              </select>
              <select
                value={addRole}
                onChange={(e) => setAddRole(e.target.value as OrgChartAccessRole)}
                className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {t(`access.roles.${role}`)}
                  </option>
                ))}
              </select>
              <button
                onClick={handleAdd}
                disabled={adding || !addUserId}
                className="rounded bg-slate-900 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {t('orgChartManager.addUser')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
