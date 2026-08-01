import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';

interface AccountMenuProps {
  email: string | undefined;
  onSignOut: () => void;
}

function initialOf(email: string | undefined): string {
  return (email ?? '?').charAt(0).toUpperCase();
}

// Consolidates language selection and sign out behind one round profile
// button, per design-critique follow-up: EN/FR and Sign out used to be two
// separate top-level header controls (see the earlier header restyle) —
// grouping account-level settings behind a single account/profile button is
// a more conventional pattern than spreading them across the header row.
// Same round-avatar visual language as PhotoAvatar.tsx's initials fallback
// (rounded-full, bold white initials on a solid background) — there's no
// per-user color here (no department to key off), so it uses the app's own
// "primary" dark (bg-slate-900), matching Ask AI's active state and
// LanguageSwitcher's own active segment.
export function AccountMenu({ email, onSignOut }: AccountMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={email}
        aria-label={t('appShell.account')}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white hover:bg-slate-700"
      >
        {initialOf(email)}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {email && (
            <div className="truncate border-b border-slate-100 px-3 py-2 text-xs text-slate-500">{email}</div>
          )}
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-sm text-slate-700">{t('appShell.language')}</span>
            <LanguageSwitcher />
          </div>
          <div className="my-1 border-t border-slate-100" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
          >
            {t('appShell.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
