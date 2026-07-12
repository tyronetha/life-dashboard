-- Harden function exposure (resolves Supabase security advisor lints 0028/0029).
-- generate_day() is SECURITY INVOKER in 0003 (RLS-scoped to the caller).
-- The privileged helpers must NOT be reachable from the public REST API; Supabase's
-- default privileges grant EXECUTE to anon/authenticated, so revoke explicitly.
-- generate_all_days runs from pg_cron as the job owner; generate_day_for is only
-- called internally by generate_all_days (SECURITY DEFINER).
revoke all on function public.generate_day_for(uuid, date) from public, anon, authenticated;
revoke all on function public.generate_all_days()          from public, anon, authenticated;
grant execute on function public.generate_all_days() to service_role;
grant execute on function public.generate_day()      to authenticated;
revoke execute on function public.generate_day()     from anon;
grant execute on function public.upsert_applications(jsonb) to authenticated;
