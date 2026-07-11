export function SupabaseSetupNotice() {
  return (
    <div className="flex h-full items-center justify-center bg-slate-50 p-8">
      <div className="max-w-lg rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        <h1 className="mb-2 text-base font-semibold">Configuration Supabase requise</h1>
        <p className="mb-3">
          Aucun projet Supabase n'est encore relié à cette application. Pour continuer :
        </p>
        <ol className="mb-3 list-decimal space-y-1 pl-5">
          <li>Créez un projet gratuit sur supabase.com</li>
          <li>
            Appliquez les migrations SQL du dossier <code className="rounded bg-amber-100 px-1">supabase/migrations</code>
          </li>
          <li>
            Copiez <code className="rounded bg-amber-100 px-1">.env.example</code> vers{' '}
            <code className="rounded bg-amber-100 px-1">.env.local</code> et renseignez l'URL et la
            clé anonyme du projet
          </li>
          <li>Relancez le serveur de développement</li>
        </ol>
      </div>
    </div>
  );
}
