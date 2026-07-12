-- ============================================================
-- LIFE Backend Design §4, §9 — normalized tables + RLS
-- All tables carry user_id and the same "own rows" RLS pattern.
-- ============================================================

-- 4.1 Routines (reusable habit definitions)
create table if not exists public.routines (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  name        text not null,
  what_to_do  text,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- 4.1 Tasks (one row per task on a specific day: daily instance OR one-off)
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  title       text not null,
  kind        text not null check (kind in ('daily','oneoff')),
  routine_id  uuid references public.routines on delete set null,
  do_date     date not null,
  done        boolean not null default false,
  done_at     timestamptz,
  what_to_do  text,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (user_id, routine_id, do_date)   -- 1 daily instance per habit per day
);

-- 4.2 Calendar events (timed or all-day; one-off or recurrence rule)
create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  title        text not null,
  event_date   date not null,
  start_min    int,          -- minutes from midnight; null = all-day
  end_min      int,
  color        text,
  recurs       text,         -- null = one-off; e.g. 'weekly'
  weekdays     int[],        -- [1..5] = Mon-Fri (0=Sun)
  recur_until  date,
  source       text not null default 'user',  -- 'user' | 'routine'
  created_at   timestamptz not null default now()
);

-- 5.1 Exceptions: skip one occurrence of a recurring event without deleting the rule
create table if not exists public.event_exceptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  event_id   uuid not null references public.events on delete cascade,
  skip_date  date not null,
  unique (event_id, skip_date)
);

-- 4.3 Applications
create table if not exists public.applications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  company    text not null,
  role       text,
  status     text not null default 'Wishlist',
  link       text,
  location   text,
  notes      text,
  applied_on date,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

-- 4.4 Books + chapters (book % is derived, never stored)
create table if not exists public.books (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  title      text not null,
  short      text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.book_chapters (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references public.books on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  number     int,
  title      text not null,
  status     text not null default 'todo' check (status in ('todo','reading','done')),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Indexes for the common range/lookup queries
create index if not exists idx_tasks_user_date        on public.tasks (user_id, do_date);
create index if not exists idx_tasks_user_kind_date   on public.tasks (user_id, kind, do_date);
create index if not exists idx_events_user_date       on public.events (user_id, event_date);
create index if not exists idx_events_user_recurs     on public.events (user_id, recurs);
create index if not exists idx_apps_user_sort         on public.applications (user_id, sort_order);
create index if not exists idx_routines_user_sort     on public.routines (user_id, sort_order);
create index if not exists idx_chapters_book          on public.book_chapters (book_id, sort_order);
create index if not exists idx_books_user_sort        on public.books (user_id, sort_order);

-- ---- RLS: enable + one "own rows" policy per table (§9) ----
do $$
declare t text;
begin
  foreach t in array array[
    'routines','tasks','events','event_exceptions','applications','books','book_chapters'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists own_rows on public.%I;', t);
    execute format(
      'create policy own_rows on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid());', t);
  end loop;
end $$;
