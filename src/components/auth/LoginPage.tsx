import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';

// Sign-in stays the primary form; sign-up is a secondary text link below it
// (backlog item 53's spec: "un lien secondaire ... pas un second bouton de
// même poids") that swaps the same email/password fields into sign-up mode
// rather than opening a whole separate page — this app has no router, and a
// login screen is small enough that a local mode toggle is simpler than
// standing one up for this alone.
export function LoginPage() {
  const { t } = useTranslation();
  const { signInWithPassword, signUp } = useAuth();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set once sign-up succeeds — replaces the form with a static message
  // rather than silently sitting on the (now pointless) sign-up form. Never
  // auto-switches to signed-in: 0015_user_roles.sql's trigger always lands
  // the new account as a pending lecteur, and AppShell's own empty-org-charts
  // branch shows the "awaiting approval" state if this project's Auth
  // settings happen to return a session immediately (no email confirmation
  // required) rather than needing a confirmation click first.
  const [signUpSubmitted, setSignUpSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    if (mode === 'signIn') {
      const { error } = await signInWithPassword(email, password);
      setSubmitting(false);
      if (error) setError(error.message);
    } else {
      const { error } = await signUp(email, password);
      setSubmitting(false);
      if (error) setError(error.message);
      else setSignUpSubmitted(true);
    }
  }

  function switchMode(next: 'signIn' | 'signUp') {
    setMode(next);
    setError(null);
    setSignUpSubmitted(false);
  }

  return (
    <div className="flex h-full items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-xl font-semibold text-slate-900">{t('appShell.title')}</h1>
        {signUpSubmitted ? (
          <>
            <p className="text-sm text-slate-600">{t('auth.signup.pendingMessage')}</p>
            <button
              type="button"
              onClick={() => switchMode('signIn')}
              className="mt-4 text-sm font-medium text-slate-700 underline hover:text-slate-900"
            >
              {t('auth.signup.backToSignIn')}
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="mb-3 block text-sm text-slate-600">
              {t('auth.login.email')}
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="mb-4 block text-sm text-slate-600">
              {t('auth.login.password')}
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting
                ? t('auth.login.connecting')
                : mode === 'signIn'
                  ? t('auth.login.signIn')
                  : t('auth.signup.submit')}
            </button>
            <button
              type="button"
              onClick={() => switchMode(mode === 'signIn' ? 'signUp' : 'signIn')}
              className="mt-3 w-full text-center text-sm text-slate-500 underline hover:text-slate-700"
            >
              {mode === 'signIn' ? t('auth.signup.createAccount') : t('auth.signup.backToSignIn')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
