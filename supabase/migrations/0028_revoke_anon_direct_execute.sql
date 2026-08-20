-- Backlog item 61 — follow-up to 0027. The `revoke ... from public` in 0027
-- removed the inherited grant, but `anon` retains a DIRECT EXECUTE grant
-- (Supabase's default schema setup grants to `anon` explicitly, not just
-- via the `public` pseudo-role). This migration revokes from `anon`
-- directly too — idempotent, safe to run whether or not 0027 already ran.
--
-- After this: only `authenticated` (and `postgres`/`service_role` which are
-- supersets) can call these. `anon` is fully locked out, which closes the
-- advisor warning: an unauthenticated caller can no longer invoke e.g.
-- is_active_admin() via /rest/v1/rpc/is_active_admin.

revoke execute on function public.is_active_user() from public, anon;
grant execute on function public.is_active_user() to authenticated;

revoke execute on function public.is_active_editor_or_admin() from public, anon;
grant execute on function public.is_active_editor_or_admin() to authenticated;

revoke execute on function public.is_active_admin() from public, anon;
grant execute on function public.is_active_admin() to authenticated;

revoke execute on function public.can_read_org_chart(uuid) from public, anon;
grant execute on function public.can_read_org_chart(uuid) to authenticated;

revoke execute on function public.can_write_org_chart(uuid) from public, anon;
grant execute on function public.can_write_org_chart(uuid) to authenticated;

revoke execute on function public.list_active_users() from public, anon;
grant execute on function public.list_active_users() to authenticated;

-- handle_new_auth_user is trigger-only, never meant to be called via REST.
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
