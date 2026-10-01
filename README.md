# MoneyFlow

Private, AI-categorized credit card expense tracking. Connect cards through Plaid,
have every transaction categorized automatically, and track spend, income and net
per month. The full design is in [PLAN.md](PLAN.md).

**Status:** Phase 2: income, reports, iPhone home-screen app, settings (export, disconnect,
delete account), daily catch-up sync, rate limits and a strict Content-Security-Policy. Built on Phase 1: connect cards with Plaid (Sandbox), transaction sync with
pending→posted handling, AI categorization with Claude Haiku 4.5, merchant rules,
a transactions page, and a monthly spend dashboard.

Background work (sync, categorization) runs in Next.js `after()` callbacks triggered
by webhooks, page views and "Sync now", instead of the job queue in PLAN.md.
That's enough for a personal app; revisit if syncs start hitting time limits.

## Stack

Next.js 16 (App Router) · Postgres + Drizzle ORM · Clerk · Plaid · Claude Haiku 4.5 ·
Tailwind + shadcn/ui · Vitest

## Getting started

Requires Node.js 20.19+ (22 LTS recommended) and a Postgres 15+ database.

1. **Install:** `npm install`
2. **Database:** create a free project at [neon.tech](https://neon.tech) and copy
   its connection string.
3. **Auth:** create an application at [clerk.com](https://clerk.com) and copy the
   publishable and secret keys.
4. **Environment:** `.env.local` was created with a generated `LOCAL_MASTER_KEY`.
   Fill in `DATABASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`
   (see `.env.example` for everything else).
5. **Migrate:** `npm run db:migrate`
6. **Run:** `npm run dev` and open http://localhost:3000

> Back up `LOCAL_MASTER_KEY` somewhere safe (a password manager). If it's lost, every
> encrypted field in the database becomes unreadable.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Unit + tenant-isolation tests (in-memory Postgres, no setup needed) |
| `npm run typecheck` / `npm run lint` | Type and lint checks |
| `npm run db:generate` | Generate a migration after editing `lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run db:studio` | Browse the database |
| `npm run smoke` | Checks Plaid Sandbox + Anthropic keys against the real APIs (no database) |

## Deploying (Vercel)

- Migrations run automatically at the start of every production build (`vercel-build` →
  `lib/db/migrate.ts`), using `MIGRATION_DATABASE_URL` (the direct, unpooled Neon URL, set for
  Production only). Preview builds skip them. A failed migration fails the build, so the previous
  version stays live. Keep migrations additive, since old code briefly runs on the new schema.
- `CRON_SECRET` must be set in Vercel for the daily catch-up sync (`vercel.json`); Vercel sends
  it to `/api/cron/sync` automatically.
- `PLAID_WEBHOOK_URL` must point at the production domain (`/api/webhooks/plaid`).
- **Feedback → GitHub issues** (optional): set `GITHUB_FEEDBACK_REPO` (`owner/name`) and
  `GITHUB_FEEDBACK_TOKEN`. Feedback goes to this (public) repo, and the form tells users their
  report will be public. Create a fine-grained token (GitHub → Settings → Developer settings →
  Fine-grained tokens) limited to that one repo, with **Issues: Read and write** only. Issues are labelled
  `feedback`, `bug`/`enhancement`/`question` and `area: …`. Each one names its sender only by a
  `reporter` ref, the first 10 hex characters of `sha256("moneyflow-feedback:" + Clerk user id)`.
  Error ids in a report match the `digest` in Vercel's logs.

## Operations

- **CI** (`.github/workflows/ci.yml`): lint, typecheck and tests on every push and pull request.
  No secrets needed. Vercel still deploys from `main` on its own; to make deploys wait for green
  CI, protect `main` in GitHub (Settings → Rules) and work in pull requests.
- **Dependencies:** Dependabot opens a weekly PR for minor/patch updates and separate PRs for
  majors. CI runs on each one.
- **Health check:** `GET /api/health` returns 200 when the app is configured and can reach the
  database, 503 otherwise, and nothing else. Point a free uptime monitor at it (e.g. UptimeRobot
  or Better Stack, every 5 minutes) to get an email when the site is down.
- **Configuration:** each server instance checks its environment at startup
  (`instrumentation.ts`, `lib/env.ts`) and logs the *names* of missing settings.
- **Errors:** every server error is logged as one JSON line with its `digest`, the same id users
  see on the error screen and in feedback reports. Search Vercel's logs for it.
- **Rate limits** (`lib/rate-limit.ts`, per user, in Postgres): linking banks, syncing, imports,
  exports, edits, feedback, and background refreshes started by page views (6 an hour), which
  is what keeps Plaid and Claude usage bounded. Webhooks are signature-verified and the cron
  route needs `CRON_SECRET`. Plaid and Claude calls time out (20s / 40s) instead of hanging.
- **Edge protection:** Vercel's platform DDoS protection is always on. If the app is ever
  hammered, turn on Attack Challenge Mode in Vercel → Firewall.
- **Backups:** Neon keeps a restore window (point-in-time restore) on its free plan; check the
  window in Neon → Settings before relying on it.

## Database roles

Isolation between users is enforced by Postgres row-level security, and RLS doesn't apply to
superusers or roles with `BYPASSRLS`. Neon's default `neondb_owner` has `BYPASSRLS` (through
`neon_superuser`), so production uses two roles:

| Variable | Role | Used for |
|---|---|---|
| `MIGRATION_DATABASE_URL` | `neondb_owner` (direct URL) | Migrations during the Vercel build |
| `DATABASE_URL` | `moneyflow_app` (pooled URL), **no `BYPASSRLS`** | Everything the app does |

Create the app role once per database (Neon → SQL Editor, as `neondb_owner`):

```sql
CREATE ROLE moneyflow_app LOGIN PASSWORD '<random password>' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE <database> TO moneyflow_app;
GRANT USAGE ON SCHEMA public TO moneyflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO moneyflow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO moneyflow_app;
-- Tables and sequences that future migrations create:
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO moneyflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO moneyflow_app;
```

Create the role in SQL, not in Neon's Roles page: roles made there join `neon_superuser` and
get `BYPASSRLS`. In production the app checks its role before its first query and refuses to
run if it can bypass RLS (`ensureRlsEnforced` in `lib/db`); `/api/health` reports 503 too.

## How data stays private

- **Row-Level Security:** every user-owned table has a *forced* RLS policy on
  `app.user_id`. App code reaches the database only through `withUser(userId, fn)`
  (`lib/db`), which sets that value inside a transaction. ESLint blocks importing the
  raw connection anywhere else. `tests/isolation` proves user A can't read or write
  user B's rows in any table.
- **Encryption:** each user has their own data key and blind-index key, stored only
  in wrapped form (encrypted by a master key: AWS KMS in production, or
  `LOCAL_MASTER_KEY`). Plaid tokens, merchant names, descriptions, account names,
  notes and labels are AES-256-GCM encrypted, bound to their table, column and
  owner. Amounts, dates and categories stay queryable for reports.
- **Deletion:** Settings → Delete account revokes every bank at Plaid and deletes the user,
  including their wrapped keys, so any ciphertext left in backups becomes unreadable.
- **Browser:** a per-request nonce Content-Security-Policy (`proxy.ts`), HSTS, no framing.
  Sensitive actions are rate limited in Postgres (`lib/rate-limit.ts`) and recorded in the audit log.
- **Feedback:** reports carry no transactions, balances, names or emails. Technical details
  are opt-in, previewed before sending, and scrubbed of amounts, card masks, long numbers,
  emails and URL query strings (`lib/feedback`); the server re-scrubs whatever it receives.

## Project layout

```
app/            routes: (app)/ is signed-in pages, api/ is webhooks
lib/auth.ts     requireUser(): sign-in check + first-visit key provisioning
lib/db/         schema, withUser(), connection (restricted)
lib/crypto/     key providers (KMS/local), field encryption, blind index, key cache
drizzle/        migrations, including RLS policies and default categories
tests/          unit/ and isolation/
```
