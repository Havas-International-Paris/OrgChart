import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return {
    session,
    loading,
    signInWithPassword: (email: string, password: string) =>
      supabase.auth.signInWithPassword({ email, password }),
    // Lands the new auth.users row through 0015_user_roles.sql's
    // on_auth_user_created trigger — always a pending lecteur, regardless of
    // whether this project's Auth settings require email confirmation
    // before a session comes back.
    signUp: (email: string, password: string) => supabase.auth.signUp({ email, password }),
    signOut: () => supabase.auth.signOut({ scope: 'global' }),
    // Backlog item 61 Phase 3 — password reset flow. redirectTo brings the
    // user back to the app root after they click the email link; Supabase
    // appends #access_token=...&type=recovery to the hash, which LoginPage
    // detects manually (detectSessionInUrl is false, see supabaseClient.ts).
    resetPasswordForEmail: (email: string) =>
      supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }),
    updatePassword: (password: string) => supabase.auth.updateUser({ password }),
  };
}
