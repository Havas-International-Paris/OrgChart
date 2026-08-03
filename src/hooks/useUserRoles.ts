import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as userRolesService from '../services/userRolesService';
import type { UserRole, UserRoleName } from '../types/domain';

// Admin screen's data source — RLS only ever actually returns every row to
// an active admin (see 0015_user_roles.sql's own_or_admin_select policy), so
// a non-admin calling this just gets back their own single row. No
// undo/redo history here unlike useDepartments.ts's sibling shape — account
// approvals aren't a chart edit, historyStore is chart-relative.
export function useUserRoles() {
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setUserRoles(await userRolesService.fetchAllUserRoles());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    const channel = supabase
      .channel(`user-roles-changes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_roles' }, () => refresh())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const approveUser = async (userId: string, role: UserRoleName) => {
    await userRolesService.approveUser(userId, role);
    await refresh();
  };

  const changeUserRole = async (userId: string, role: UserRoleName) => {
    await userRolesService.changeUserRole(userId, role);
    await refresh();
  };

  const refuseUser = async (userId: string) => {
    await userRolesService.refuseUser(userId);
    await refresh();
  };

  return { userRoles, loading, error, approveUser, changeUserRole, refuseUser };
}
