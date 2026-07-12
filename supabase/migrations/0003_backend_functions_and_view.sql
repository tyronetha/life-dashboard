-- ============================================================
-- LIFE Backend Design §4.4, §5, §6 — view + RPC functions
-- (Function grants are hardened in 0005.)
-- ============================================================

-- 4.4 Derived book progress (never stored). security_invoker so RLS of
-- the underlying tables applies to the querying user.
create or replace view public.book_progress
with (security_invoker = true) as
select b.id, b.user_id, b.title, b.short, b.sort_order,
       count(c.*)                                          as total,
       count(c.*) filter (where c.status = 'done')         as done,
       coalesce(round(100.0 * count(c.*) filter (where c.status = 'done')
             / nullif(count(c.*), 0)), 0)::int             as pct
from public.books b
left join public.book_chapters c on c.book_id = b.id
group by b.id, b.user_id, b.title, b.short, b.sort_order;

-- 5.3 Batch upsert applications atomically (SECURITY INVOKER -> RLS enforced).
create or replace function public.upsert_applications(rows jsonb)
returns void language sql security invoker set search_path = public as $$
  insert into public.applications
    (id, user_id, company, role, status, link, location, applied_on, notes, sort_order, updated_at)
  select coalesce((r->>'id')::uuid, gen_random_uuid()),
         auth.uid(), r->>'company', r->>'role', coalesce(r->>'status','Wishlist'),
         r->>'link', r->>'location', (r->>'applied_on')::date, r->>'notes',
         coalesce((r->>'sort_order')::int, 0), now()
  from jsonb_array_elements(rows) r
  where coalesce(r->>'company','') <> ''
  on conflict (id) do update set
    company = excluded.company, role = excluded.role, status = excluded.status,
    link = excluded.link, location = excluded.location, applied_on = excluded.applied_on,
    notes = excluded.notes, sort_order = excluded.sort_order, updated_at = now();
$$;

-- 5.2 Core daily generation for one user on one day (idempotent).
create or replace function public.generate_day_for(uid uuid, d date)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.tasks (user_id, title, kind, routine_id, do_date, what_to_do)
  select r.user_id, r.name, 'daily', r.id, d, r.what_to_do
  from public.routines r
  where r.user_id = uid and r.active = true
  on conflict (user_id, routine_id, do_date) do nothing;

  update public.tasks set do_date = d
   where user_id = uid and kind = 'oneoff'
     and done = false and archived = false and do_date < d;

  update public.tasks set archived = true
   where user_id = uid and kind = 'daily' and do_date < d and archived = false;
end;
$$;

-- Client fallback (§7): run generation for the caller, in fixed EST/EDT.
-- Made SECURITY INVOKER in 0005 (only touches the caller's own RLS-scoped rows).
create or replace function public.generate_day()
returns void language plpgsql security invoker set search_path = public as $$
declare d date := (now() at time zone 'America/New_York')::date;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.tasks (user_id, title, kind, routine_id, do_date, what_to_do)
  select r.user_id, r.name, 'daily', r.id, d, r.what_to_do
  from public.routines r
  where r.user_id = auth.uid() and r.active = true
  on conflict (user_id, routine_id, do_date) do nothing;

  update public.tasks set do_date = d
   where user_id = auth.uid() and kind = 'oneoff'
     and done = false and archived = false and do_date < d;

  update public.tasks set archived = true
   where user_id = auth.uid() and kind = 'daily' and do_date < d and archived = false;
end;
$$;

-- Scheduled nightly job (§7, §11): generate for every user, then prune >1yr history.
create or replace function public.generate_all_days()
returns void language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'America/New_York')::date; u uuid;
begin
  for u in select id from auth.users loop
    perform public.generate_day_for(u, d);
  end loop;
  delete from public.tasks  where archived = true and do_date < (d - interval '1 year');
  delete from public.events where recurs is null and event_date < (d - interval '1 year');
end;
$$;
