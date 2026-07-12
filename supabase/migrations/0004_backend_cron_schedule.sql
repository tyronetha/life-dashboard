-- §7 — nightly scheduled generation via pg_cron
create extension if not exists pg_cron;

-- Run generate_all_days() daily at 05:10 UTC (~00:10 EST / 01:10 EDT —
-- just after local midnight in America/New_York). Idempotent, so exact
-- timing is forgiving. cron.schedule upserts by job name.
select cron.schedule(
  'life-generate-daily',
  '10 5 * * *',
  $$ select public.generate_all_days(); $$
);
