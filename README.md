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

## Local development

```bash
python3 -m http.server 4137
# open http://localhost:4137
```

For magic-link sign-in to work locally, add `http://localhost:4137` to the project's
**Auth → URL Configuration → Redirect URLs** in the Supabase dashboard.

## Deploy

Hosted via GitHub Pages from the repository root on the default branch.
