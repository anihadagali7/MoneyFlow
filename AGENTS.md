<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# MoneyFlow: rules for every coding agent

These apply to every agent working in this repo (Claude Code, Cursor, Copilot, …) and to people.
Design and roadmap: PLAN.md. Setup, security model and operations: README.md.

## Sharing the repo with other agents

- One agent per checkout. Run `git status` before you start: if there are changes you didn't
  make, another agent or the owner is mid-task. Stop and ask instead of working around them.
- For parallel work, use your own worktree and branch:
  `git worktree add ../MoneyFlow-<task> -b <task>`.
- Never stash, reset, check out over, or discard changes you didn't make, and never switch the
  branch of a checkout someone else is using.
- Stage files by name. Don't `git add -A` or `git commit -a` when the tree has other people's work.

## Commits, pushes and deploys

- `main` deploys straight to production on Vercel, and the build runs database migrations.
  Never push to `main`, merge a PR or force-push without the owner's explicit OK, each time.
- One change per commit, with a message that says what changed and why. No "wip" or
  "changes" commits, and don't bundle unrelated fixes into one commit.
- Before committing, all of these pass on Node 24 (`nvm use` reads `.nvmrc`):
  `npm run lint`, `npm run typecheck`, `npm test`. If you added a route, run
  `npx next typegen` first.
- Never commit secrets or `.env*` files. Fake keys in tests must not look like real ones
  (GitHub push protection rejects strings like `sk_live_…`).
- Dependencies: test major upgrades before merging. `@types/node` follows `.nvmrc`;
  TypeScript stays on 5.x until typescript-eslint supports 7.

## Data, privacy and security (non-negotiable)

- All DB access goes through `withUser(userId, fn)` from `@/lib/db`. Never import
  `lib/db/client` or `lib/db/core` outside `lib/db` (ESLint enforces this).
- Every new user-owned table needs `user_id`, a forced RLS policy in a migration, and an entry
  in `USER_TABLES` in `tests/isolation/tenantIsolation.test.ts`.
- Sensitive text (merchant, description, names, notes, labels) goes in `*_ct` columns via
  `encryptField(dek, value, fieldAad(table, column, userId))`. Money is bigint cents with
  Plaid's sign (positive = money out).
- Protected pages, Server Actions and Route Handlers call `requireUser()` themselves;
  `proxy.ts` doesn't enforce auth.
- "Today" and month boundaries come from `loadUserContext()` (the user's timezone), never
  `new Date()` on the server (Vercel runs in UTC).
- Schema changes: edit `lib/db/schema.ts`, run `npm run db:generate` and commit the new file
  in `drizzle/`, then `npm run db:migrate` locally. Production migrates itself during the
  Vercel build (`lib/db/migrate.ts`). Keep migrations additive and backward compatible.
- `DATABASE_URL` must connect as a role without `BYPASSRLS` or superuser rights (Neon's
  `neondb_owner` has `BYPASSRLS`; README: "Database roles"). Tests run as an ordinary role,
  so they won't catch this. Never filter "is this the user's row?" by RLS alone: use an
  explicit `where` on the user id.
- Never bypass row-level security, and never read production user data. Production database
  access is limited to read-only schema checks.
- Never send user financial data anywhere new: logs, analytics, prompts or GitHub issues.
  In-app feedback becomes **public** issues in this repo, so it stays scrubbed (`lib/feedback`).
- Language models only see data through the read-only tools in `lib/ask/tools.ts`, which run
  under `withUser`. A model never writes SQL, and totals come from the database, not the model.

## Code conventions

- Server Actions return `{ ok: false, error }` for expected failures (validation, rate
  limits, not found) instead of throwing, and the UI shows the error.
- Validate dates with `z.iso.date()` so impossible dates (Feb 31) are rejected before Postgres.
- Every behaviour change gets a test. Tests use PGlite and the fixtures in `tests/helpers`:
  no network calls and no real keys.

## UI

- The owner mostly uses the iPhone home-screen app. Check every UI change at 375px wide
  (`/dev/preview?view=…` renders each screen with sample data), with no sideways scrolling.
- Page grids use `grid-cols-1` as the base so long text can't widen the column, and flex items
  that truncate need `min-w-0`.
