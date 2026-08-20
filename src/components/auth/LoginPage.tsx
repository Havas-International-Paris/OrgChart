import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabaseClient';

// Sign-in stays the primary form; sign-up is a secondary text link below it
// (backlog item 53's spec: "un lien secondaire ... pas un second bouton de
// même poids") that swaps the same email/password fields into sign-up mode
// rather than opening a whole separate page — this app has no router, and a
// login screen is small enough that a local mode toggle is simpler than
// standing one up for this alone.
//
// Backlog item 61 Phase 3 added two more modes for the password reset flow:
// 'resetRequest' (enter email → resetPasswordForEmail sends a link) and
// 'resetConfirm' (enter new password → updateUser). The recovery callback
// (#access_token=...&type=recovery in the URL hash, from Supabase's email
// redirect) is detected manually at mount because detectSessionInUrl is
// false (see supabaseClient.ts) — only type=recovery is processed, not
// arbitrary access tokens, so an attacker can't session-fixate by crafting
// a URL with their own token.
type Mode = 'signIn' | 'signUp' | 'resetRequest' | 'resetConfirm';

export function LoginPage() {
  const { t } = useTranslation();
  const { signInWithPassword, signUp, resetPasswordForEmail, updatePassword } = useAuth();
  const [mode, setMode] = useState<Mode>('signIn');
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
  // Set once reset email is sent or password is updated — same pattern as
  // signUpSubmitted: replaces the form with a static confirmation message.
  const [resetSubmitted, setResetSubmitted] = useState(false);

  // Detect the recovery callback on mount. Supabase's reset email redirects
  // to redirectTo with #access_token=...&refresh_token=...&type=recovery in
  // the hash. We only process type=recovery (never a bare access_token
  // without that type), establish the session via setSession, clean the URL,
  // and switch to resetConfirm mode.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (params.get('type') !== 'recovery') return;
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) return;
    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    window.history.replaceState(null, '', window.location.pathname);
    setMode('resetConfirm');
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    if (mode === 'signIn') {
      const { error } = await signInWithPassword(email, password);
      setSubmitting(false);
      if (error) setError(error.message);
    } else if (mode === 'signUp') {
      const { error } = await signUp(email, password);
      setSubmitting(false);
      if (error) setError(error.message);
      else setSignUpSubmitted(true);
    } else if (mode === 'resetRequest') {
      const { error } = await resetPasswordForEmail(email);
      setSubmitting(false);
      if (error) setError(error.message);
      else setResetSubmitted(true);
    } else if (mode === 'resetConfirm') {
      const { error } = await updatePassword(password);
      setSubmitting(false);
      if (error) setError(error.message);
      else setResetSubmitted(true);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setSignUpSubmitted(false);
    setResetSubmitted(false);
  }

  const isReset = mode === 'resetRequest' || mode === 'resetConfirm';
  const submittedMessage =
    mode === 'signUp' ? signUpSubmitted : mode === 'resetRequest' || mode === 'resetConfirm' ? resetSubmitted : false;

  return (
    <div className="flex h-full items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-xl font-semibold text-slate-900">{t('appShell.title')}</h1>
        {submittedMessage ? (
          <>
            <p className="text-sm text-slate-600">
              {mode === 'signUp'
                ? t('auth.signup.pendingMessage')
                : mode === 'resetRequest'
                  ? t('auth.reset.sentMessage')
                  : t('auth.reset.success')}
            </p>
            <button
              type="button"
              onClick={() => switchMode('signIn')}
              className="mt-4 text-sm font-medium text-slate-700 underline hover:text-slate-900"
            >
              {t('auth.reset.backToSignIn')}
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            {isReset ? (
              <label className="mb-4 block text-sm text-slate-600">
                {mode === 'resetRequest' ? t('auth.reset.email') : t('auth.reset.newPassword')}
                <input
                  type={mode === 'resetRequest' ? 'email' : 'password'}
                  required
                  value={mode === 'resetRequest' ? email : password}
                  onChange={(e) =>
                    mode === 'resetRequest' ? setEmail(e.target.value) : setPassword(e.target.value)
                  }
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            ) : (
              <>
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
              </>
            )}
            {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting
                ? isReset
                  ? t('auth.reset.sending')
                  : t('auth.login.connecting')
                : mode === 'signIn'
                  ? t('auth.login.signIn')
                  : mode === 'signUp'
                    ? t('auth.signup.submit')
                    : mode === 'resetRequest'
                      ? t('auth.reset.submit')
                      : t('auth.reset.confirm')}
            </button>
            {mode === 'signIn' && (
              <button
                type="button"
                onClick={() => switchMode('resetRequest')}
                className="mt-3 w-full text-center text-sm text-slate-500 underline hover:text-slate-700"
              >
                {t('auth.reset.forgotPassword')}
              </button>
            )}
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
