-- Backlog item 61 Phase 3 follow-up — closes the Supabase advisor warnings
-- about SECURITY DEFINER functions being callable by anon/authenticated via
-- PostgREST (/rest/v1/rpc/...). These functions MUST stay SECURITY DEFINER
-- to avoid RLS recursion (a policy on user_roles calling is_active_admin()
-- which itself queries user_roles would otherwise be circular — see
-- 0015_user_roles.sql). What was wrong is that Postgres grants EXECUTE to
-- the `public` pseudo-role by default on every new function, and `anon` is
-- a member of `public`, so an unauthenticated caller could invoke e.g.
-- is_active_admin() via the REST API — an information-disclosure vector
-- (not a real security hole, since the result is already available via
-- user_roles' own RLS, but still a surface worth closing).
--
-- Fix: revoke EXECUTE from public (removes the implicit grant to both anon
-- AND authenticated), then re-grant to authenticated only. RLS policies
-- execute as the calling user, who is always authenticated when a session
-- exists, so they keep working. anon never needs these — every policy
-- already gates on is_active_user() which returns false for anon.

revoke execute on function public.is_active_user() from public;
grant execute on function public.is_active_user() to authenticated;

revoke execute on function public.is_active_editor_or_admin() from public;
grant execute on function public.is_active_editor_or_admin() to authenticated;

revoke execute on function public.is_active_admin() from public;
grant execute on function public.is_active_admin() to authenticated;

revoke execute on function public.can_read_org_chart(uuid) from public;
grant execute on function public.can_read_org_chart(uuid) to authenticated;

revoke execute on function public.can_write_org_chart(uuid) from public;
grant execute on function public.can_write_org_chart(uuid) to authenticated;

-- list_active_users was already grant-to-authenticated in 0017/0019, but
-- the implicit public grant was never revoked, so anon could still call it.
revoke execute on function public.list_active_users() from public;
grant execute on function public.list_active_users() to authenticated;

-- handle_new_auth_user is a trigger on auth.users, never meant to be
-- called directly via PostgREST at all. Revoke from public entirely and
-- don't re-grant — the trigger fires as the function owner (security
-- definer), not as a REST caller.
revoke execute on function public.handle_new_auth_user() from public;
