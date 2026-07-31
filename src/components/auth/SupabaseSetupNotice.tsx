import { useTranslation } from 'react-i18next';

export function SupabaseSetupNotice() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center bg-slate-50 p-8">
      <div className="max-w-lg rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        <h1 className="mb-2 text-base font-semibold">{t('auth.setupNotice.title')}</h1>
        <p className="mb-3">{t('auth.setupNotice.intro')}</p>
        <ol className="mb-3 list-decimal space-y-1 pl-5">
          <li>{t('auth.setupNotice.step1')}</li>
          <li>
            {t('auth.setupNotice.step2')}{' '}
            <code className="rounded bg-amber-100 px-1">supabase/migrations</code>{' '}
            {t('auth.setupNotice.step2suffix')}
          </li>
          <li>
            {t('auth.setupNotice.step3prefix')} <code className="rounded bg-amber-100 px-1">.env.example</code>{' '}
            {t('auth.setupNotice.step3middle')} <code className="rounded bg-amber-100 px-1">.env.local</code>{' '}
            {t('auth.setupNotice.step3suffix')}
          </li>
          <li>{t('auth.setupNotice.step4')}</li>
        </ol>
      </div>
    </div>
  );
}
