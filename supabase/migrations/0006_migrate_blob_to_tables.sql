-- §8 one-time migration: fan each user's dashboards.data blob into the normalized
-- tables. Per-table "if empty" guards make it safe to re-run. The blob is kept as
-- a backup and continues to hold the free-form bits (quotes, "currently", weights).
do $$
declare rec record; d jsonb;
begin
  for rec in select user_id, data from public.dashboards loop
    d := rec.data;

    if not exists (select 1 from public.routines where user_id = rec.user_id) then
      insert into public.routines (user_id, name, what_to_do, active, sort_order)
      select rec.user_id, x->>'name', nullif(x->>'whatToDo',''),
             coalesce((x->>'active')::boolean, true), coalesce((x->>'order')::int, 0)
      from jsonb_array_elements(coalesce(d->'routines','[]'::jsonb)) x
      where coalesce(x->>'name','') <> '';
    end if;

    if not exists (select 1 from public.tasks where user_id = rec.user_id) then
      insert into public.tasks (user_id, title, kind, routine_id, do_date, done, what_to_do, archived)
      select rec.user_id, x->>'title',
             case when x->>'type' = 'Daily' then 'daily' else 'oneoff' end,
             case when x->>'type' = 'Daily'
                  then (select r.id from public.routines r
                         where r.user_id = rec.user_id and r.name = x->>'title' limit 1) end,
             coalesce((x->>'doDate')::date, (now() at time zone 'America/New_York')::date),
             coalesce((x->>'done')::boolean, false), nullif(x->>'whatToDo',''),
             coalesce((x->>'archived')::boolean, false)
      from jsonb_array_elements(coalesce(d->'tasks','[]'::jsonb)) x
      where coalesce(x->>'title','') <> ''
      on conflict (user_id, routine_id, do_date) do nothing;
    end if;

    if not exists (select 1 from public.applications where user_id = rec.user_id) then
      insert into public.applications (user_id, company, role, status, sort_order)
      select rec.user_id, x->>'company', nullif(x->>'role',''),
             coalesce(nullif(x->>'status',''),'Wishlist'), coalesce((x->>'order')::int, 0)
      from jsonb_array_elements(coalesce(d->'apps','[]'::jsonb)) x
      where coalesce(x->>'company','') <> '';
    end if;

    if not exists (select 1 from public.books where user_id = rec.user_id) then
      insert into public.books (user_id, title, short, sort_order)
      select rec.user_id, x->>'title', nullif(x->>'short',''), (row_number() over ())::int
      from jsonb_array_elements(coalesce(d->'books','[]'::jsonb)) x
      where coalesce(x->>'title','') <> '';
    end if;

    if not exists (select 1 from public.events where user_id = rec.user_id) then
      insert into public.events (user_id, title, event_date, source)
      select rec.user_id, e->>'text', (kv.key)::date, 'user'
      from jsonb_each(coalesce(d->'events','{}'::jsonb)) kv,
           jsonb_array_elements(kv.value) e
      where coalesce(e->>'text','') <> '';
    end if;
  end loop;
end $$;
