# Redrob HRMS

HR Management System for ~250 employees, covering employee records, shift/roster, holidays,
onboarding/offboarding, performance, learning, workflow approvals, helpdesk, announcements,
notifications, analytics, ATS/recruitment, assets, and an AI assistant.

## Structure

The whole app lives in [`webapp/`](webapp) — a single Next.js app that hosts both the UI and the
API:

- `webapp/src/app/` — pages (client-rendered, one per module) and Route Handlers under
  `api/v1/*` (one per REST resource) and `api/cron/*` (scheduled jobs).
- `webapp/src/server/` — business logic per module (`server/modules/*/service.ts`), plus shared
  helpers: `server/lib/route.ts` (auth/role/validation/audit — the `withRoute()` wrapper every API
  route uses), `server/lib/auth.ts` (JWT/MFA/refresh tokens), `server/lib/prisma.ts` (DB client),
  `server/lib/cron.ts` (shared-secret auth for scheduled jobs).
- `webapp/src/modules/`, `webapp/src/shared/`, `webapp/src/components/ui/` — frontend: per-module
  pages/API clients, auth/theme/toast context, and shared UI components.
- `webapp/prisma/` — schema and migrations for the Postgres database.

There used to be a separate NestJS backend and Vite frontend, deployed independently to Railway
and Vercel. Both have been folded into `webapp/` and decommissioned — see
[`docs/`](docs) for background if useful, though it now describes history rather than the current
setup.

## Stack

- **App + API**: Next.js (App Router), deployed on Vercel.
- **Database**: Postgres on Supabase.
- **Scheduled jobs**: Vercel Cron (`webapp/vercel.json`) for daily/weekly jobs; hourly jobs
  run via Supabase's `pg_cron`/`pg_net` calling the same `api/cron/*` routes (Vercel's free
  tier only allows daily-or-coarser cron schedules) — set up once per environment by running
  `webapp/supabase/cron-jobs.sql` against that Supabase project's SQL editor. Every route
  under `webapp/src/app/api/cron/` must be wired up in exactly one of these two places —
  see HRMS-22 in the security audit history, where 5 routes existed in code with no
  schedule anywhere, silently never running.
- **Auth**: custom JWT access/refresh tokens with MFA, stored in `localStorage` — not a
  third-party auth provider.

## Local development

```bash
docker compose up -d          # local Postgres (see docker-compose.yml)
cd webapp
cp .env.example .env          # fill in DATABASE_URL/DIRECT_URL, JWT secrets, etc.
npm install
npx prisma migrate deploy
npm run dev                   # http://localhost:3000
```

Other useful commands (run from `webapp/`):

```bash
npm run build      # production build
npm test           # jest unit tests
npm run lint       # eslint
npx tsc --noEmit   # typecheck
```

## Deployment

Production runs on Vercel, pointed at a Supabase Postgres database — see `webapp/vercel.json`
for the cron schedule and `webapp/.env.example` for the required environment variables.
