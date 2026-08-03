import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as userRolesService from '../services/userRolesService';
import type { UserRoleName, UserRoleStatus } from '../types/domain';

// The signed-in user's OWN role/status — every gating decision in the app
// (admin-only menu items, the pending-approval empty state) reads this, not
// useUserRoles' full table. Filtering the realtime subscription by
// `user_id=eq.<uid>` is safe here specifically because user_id IS this
// table's primary key — unlike the documented org_chart_id filter gotcha in
// CLAUDE.md (a non-PK filter silently drops DELETE events under Postgres'
// default replica identity), a PK filter always ships in the WAL DELETE
// entry.
export function useCurrentUserRole(userId: string | undefined) {
  const [role, setRole] = useState<UserRoleName | null>(null);
  const [status, setStatus] = useState<UserRoleStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setRole(null);
      setStatus(null);
      setLoading(false);
      return;
    }
    try {
      const own = await userRolesService.fetchOwnUserRole(userId);
      setRole(own?.role ?? null);
      setStatus(own?.status ?? null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refresh();
    if (!userId) return;

    const channel = supabase
      .channel(`own-user-role-changes-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_roles', filter: `user_id=eq.${userId}` },
        () => refresh(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  return { role, status, loading };
}
