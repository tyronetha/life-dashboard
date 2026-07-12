-- Original persistence: one jsonb blob per user (kept as a backup / for the
-- free-form bits per Backend Design §8). Applied in the first build.
create table if not exists public.dashboards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.dashboards enable row level security;

create policy "Users can view own dashboard"
  on public.dashboards for select using (auth.uid() = user_id);
create policy "Users can insert own dashboard"
  on public.dashboards for insert with check (auth.uid() = user_id);
create policy "Users can update own dashboard"
  on public.dashboards for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own dashboard"
  on public.dashboards for delete using (auth.uid() = user_id);
