@AGENTS.md

# MoneyFlow

Design and roadmap: PLAN.md. Setup and security model: README.md.

- All DB access goes through `withUser(userId, fn)` from `@/lib/db`. Never import `lib/db/client` or `lib/db/core` outside `lib/db` (ESLint enforces this).
- Every new user-owned table needs `user_id`, a forced RLS policy in a migration, and an entry in `USER_TABLES` in `tests/isolation/tenantIsolation.test.ts`.
- Sensitive text (merchant, description, names, notes, labels) goes in `*_ct` columns via `encryptField(dek, value, fieldAad(table, column, userId))`. Money is bigint cents with Plaid's sign (positive = money out).
- Protected pages, Server Actions and Route Handlers call `requireUser()` themselves; `proxy.ts` doesn't enforce auth.
- "Today" and month boundaries come from `loadUserContext()` (user's timezone), never `new Date()` on the server (Vercel runs in UTC).
- Schema changes: `npm run db:generate`, then migrate production before deploying.
- Run `npm test`, `npm run lint` and `npm run typecheck` before finishing a change.
