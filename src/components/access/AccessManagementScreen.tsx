import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUserRoles } from '../../hooks/useUserRoles';
import type { UserRoleName } from '../../types/domain';

const ROLE_OPTIONS: UserRoleName[] = ['admin', 'editeur', 'lecteur'];

function PendingRow({
  email,
  onApprove,
  onRefuse,
}: {
  email: string;
  onApprove: (role: UserRoleName) => void;
  onRefuse: () => void;
}) {
  const { t } = useTranslation();
  const [role, setRole] = useState<UserRoleName>('lecteur');

  return (
    <tr className="border-b border-slate-100">
      <td className="px-3 py-2 text-sm text-slate-700">{email}</td>
      <td className="px-3 py-2">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as UserRoleName)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(`access.roles.${option}`)}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={() => onApprove(role)}
          className="mr-2 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {t('access.approve')}
        </button>
        <button
          type="button"
          onClick={onRefuse}
          className="rounded border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
        >
          {t('access.refuse')}
        </button>
      </td>
    </tr>
  );
}

function RefusedRow({ email, onReapprove }: { email: string; onReapprove: () => void }) {
  const { t } = useTranslation();
  return (
    <tr className="border-b border-slate-100">
      <td className="px-3 py-2 text-sm text-slate-700">{email}</td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={onReapprove}
          className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {t('access.reapprove')}
        </button>
      </td>
    </tr>
  );
}

function ActiveRow({
  email,
  role,
  onChangeRole,
}: {
  email: string;
  role: UserRoleName;
  onChangeRole: (role: UserRoleName) => void;
}) {
  const { t } = useTranslation();
  return (
    <tr className="border-b border-slate-100">
      <td className="px-3 py-2 text-sm text-slate-700">{email}</td>
      <td className="px-3 py-2">
        <select
          value={role}
          onChange={(e) => onChangeRole(e.target.value as UserRoleName)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(`access.roles.${option}`)}
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
}

// Full-screen replacement for the grid/chart split (not a modal — per the
// spec, always reachable back to the chart, never a dead end), reached from
// AccountMenu.tsx's admin-only entry. Single-section for now: the
// "Organigrammes" tab (per-chart sharing) is a later, separate item — see
// backlog item 53's scope note.
export function AccessManagementScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { userRoles, loading, approveUser, changeUserRole, refuseUser } = useUserRoles();

  const pending = userRoles.filter((u) => u.status === 'pending');
  const refused = userRoles.filter((u) => u.status === 'refused');
  const active = userRoles.filter((u) => u.status === 'active');

  return (
    <div className="flex-1 overflow-auto p-6">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        {t('access.backToChart')}
      </button>
      <h1 className="mb-6 text-lg font-semibold text-slate-900">{t('appShell.accessManagement')}</h1>

      {loading ? (
        <p className="text-sm text-slate-400">{t('access.loading')}</p>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('access.pendingRequests')}
            </h2>
            {pending.length === 0 ? (
              <p className="text-sm text-slate-400">{t('access.noPendingRequests')}</p>
            ) : (
              <table className="w-full max-w-2xl border-collapse">
                <tbody>
                  {pending.map((u) => (
                    <PendingRow
                      key={u.user_id}
                      email={u.email}
                      onApprove={(role) => approveUser(u.user_id, role)}
                      onRefuse={() => refuseUser(u.user_id)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="mb-8">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('access.refusedRequests')}
            </h2>
            {refused.length === 0 ? (
              <p className="text-sm text-slate-400">{t('access.noRefusedRequests')}</p>
            ) : (
              <table className="w-full max-w-2xl border-collapse">
                <tbody>
                  {refused.map((u) => (
                    <RefusedRow
                      key={u.user_id}
                      email={u.email}
                      onReapprove={() => approveUser(u.user_id, 'lecteur')}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('access.users')}
            </h2>
            <table className="w-full max-w-2xl border-collapse">
              <tbody>
                {active.map((u) => (
                  <ActiveRow
                    key={u.user_id}
                    email={u.email}
                    role={u.role}
                    onChangeRole={(role) => changeUserRole(u.user_id, role)}
                  />
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
