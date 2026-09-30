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

- Run migrations against the production database **before** pushing code that needs them:
  `DATABASE_URL="<direct connection string>" npm run db:migrate`
- `CRON_SECRET` must be set in Vercel for the daily catch-up sync (`vercel.json`); Vercel sends
  it to `/api/cron/sync` automatically.
- `PLAID_WEBHOOK_URL` must point at the production domain (`/api/webhooks/plaid`).

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

## Project layout

```
app/            routes: (app)/ is signed-in pages, api/ is webhooks
lib/auth.ts     requireUser(): sign-in check + first-visit key provisioning
lib/db/         schema, withUser(), connection (restricted)
lib/crypto/     key providers (KMS/local), field encryption, blind index, key cache
drizzle/        migrations, including RLS policies and default categories
tests/          unit/ and isolation/
```
