-- Move the nightly generation to 5:00 AM America/New_York.
-- pg_cron runs in UTC: 09:00 UTC = 5:00 AM EDT (summer). When DST ends this
-- fires at 4:00 AM EST — harmless (generation is idempotent and date-based);
-- switch to '0 10 * * *' in winter if exact 5:00 AM matters.
select cron.schedule(
  'life-generate-daily',
  '0 9 * * *',
  $$ select public.generate_all_days(); $$
);
