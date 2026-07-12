# L I F E — a life planner

A personal life-planner dashboard (tasks, daily habits, calendar, LeetCode tracker,
job applications, and interview prep), hosted on **GitHub Pages** with per-user data
stored in **Supabase**.

Built from a Claude Design prototype (`L I F E Dashboard.dc.html`). The original
template and rendering logic are preserved verbatim; only persistence was swapped from
`localStorage` to Supabase (with `localStorage` kept as an offline cache).

## How it works

| File | Role |
|------|------|
| `index.html` | Page shell, fonts/styles, login gate, and the design template (in a `<template>`). |
| `runtime.js` | Tiny renderer for the design's `sc-for` / `sc-if` / `{{ }}` template syntax; morphs the DOM so text-input focus survives re-renders. |
| `dashboard.js` | The original dashboard logic (unchanged apart from `save()` / `componentDidMount()`, which now sync through Supabase). |
| `boot.js` | Supabase client, the `DB` sync layer, magic-link login gate, and mounting. |
| `config.js` | Supabase URL + publishable key (safe to commit — row-level security protects data). |

## Auth & data

- Sign-in is a **magic link** emailed via Supabase Auth — no passwords.
- Each user's dashboard is one row in the `dashboards` table (`user_id`, `data jsonb`,
  `updated_at`), guarded by row-level security so users only see their own data.
- Data is a single JSON blob (tasks, routines, apps, solves, books, goals, weights…),
  saved debounced on every change.

## Backend (normalized schema)

Per [`LIFE Backend Design`](https://claude.ai/design/p/f4f47b6e-56f4-4a36-9b4c-594057001b69?file=LIFE+Backend+Design.dc.html),
the backend is evolving from the single JSONB blob into real tables so the calendar,
daily routine, applications, and prep become persistent, query-able, multi-day features.
SQL lives in [`supabase/migrations/`](supabase/migrations/):

| Object | Purpose |
|--------|---------|
| `routines`, `tasks` | Habit definitions + one row per task per day (daily instance or one-off). `unique(user_id, routine_id, do_date)` makes daily generation idempotent. |
| `events`, `event_exceptions` | Calendar events (timed/all-day, one-off or weekly recurrence); exceptions skip one occurrence without deleting the rule. |
| `applications` | Job pipeline with `link`/`location`/`applied_on`/`notes` for spreadsheet-style entry. |
| `books`, `book_chapters` | Prep; book progress is **derived** from chapter status (never stored). |
| `book_progress` (view) | `done / total` per book, `security_invoker` so RLS applies. |
| `upsert_applications(rows jsonb)` | Batch upsert so an editable grid saves many rows in one round-trip. |
| `generate_day()` | Client fallback: materialize today's habits + roll unfinished one-offs forward, fixed **America/New_York**. Idempotent. |
| `generate_all_days()` + `pg_cron` | Nightly job (05:10 UTC) that runs generation for every user even when the app is closed, and prunes >1yr history. |

Every table has RLS (`user_id = auth.uid()`). The `dashboards` blob is retained as a
backup and for free-form bits (quotes, "currently", weights) until each feature's UI is
switched over to the tables.

**Status:** Phase 1 (schema + RLS + RPCs + scheduled job + blob migration) is live.
Frontend wiring (Prep chapters → Applications grid → editable Calendar) is next.

## Local development

```bash
python3 -m http.server 4137
# open http://localhost:4137
```

For magic-link sign-in to work locally, add `http://localhost:4137` to the project's
**Auth → URL Configuration → Redirect URLs** in the Supabase dashboard.

## Deploy

Hosted via GitHub Pages from the repository root on the default branch.
