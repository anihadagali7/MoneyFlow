# Planning Prompt: Private, AI-Categorized Expense Tracker (Next.js + Plaid)

> Copy everything below the line into the model.

---

## Role

You are a senior full-stack architect and security engineer with production experience in fintech apps, the Plaid API, Next.js (App Router), PostgreSQL, and LLM integrations. Produce a **complete, implementation-ready plan** for the app described below. Be opinionated: when there's a choice, pick one option, justify it briefly, and name the runner-up. Flag anything that is a legal, compliance, or cost risk.

Don't write the full app yet. Write the plan, with code snippets only where they make a design decision concrete (schemas, key function signatures, prompt templates, config).

## Product summary

A web app where each user:

1. Signs up / logs in with an account that keeps their financial data private and encrypted.
2. Connects one or more credit card accounts through **Plaid Link** (the user never gives credentials to our app).
3. Sees the latest transactions for each card, synced automatically.
4. Gets each transaction **auto-labeled by an LLM** into a spending category (e.g., Groceries, Bills & Utilities, Streaming Subscriptions, Dining, Travel – Flights, Travel – Lodging/Vacation, Gas, Shopping, Health, Entertainment, Transfers/Payments, Other). Users can correct a label, and corrections should improve future labels.
5. Enters **income** (recurring salary and one-off amounts).
6. Views **reports**: total spend over the past N months (user-selectable: 1, 3, 6, 12, custom), spend by category, spend by card, month-over-month trend, and **net (income − spend) per month**.

## Architecture decisions (already made; validate or challenge them)

- **Framework:** Next.js 15+ (App Router, TypeScript, Server Components). Route Handlers and Server Actions act as the backend. No separate backend service unless you can justify one.
- **A server-side backend is required.** Plaid `client_id`/`secret` and every Plaid `access_token` must never reach the browser. The flow: the client opens Plaid Link with a server-created `link_token` → the client receives a `public_token` → the server exchanges it for an `access_token` → the server stores it encrypted.
- **A database is required.** Reasons: store encrypted Plaid access tokens and item/account metadata; keep a local copy of transactions (Plaid's `/transactions/sync` is cursor-based and incremental, and re-fetching on every page load is slow and costly); persist LLM categories and user overrides; store income entries; make reports fast.
  - Default choice: **PostgreSQL** (managed: Neon or Supabase) with **Drizzle ORM** (or Prisma, if you think it's better here).
- **Auth:** Pick one of Auth.js (NextAuth v5), Clerk, or Supabase Auth, and justify the pick. Requirements: email + OAuth (Google), MFA/passkeys strongly preferred, secure HTTP-only session cookies, rate-limited login.
- **Background jobs:** Something for Plaid webhooks and async categorization (e.g., Inngest, Trigger.dev, or Upstash QStash + Vercel Cron). Pick one.
- **Hosting:** Vercel (or justify an alternative).
- **LLM:** Anthropic Claude API. Use a small, cheap model (Claude Haiku 4.5, `claude-haiku-4-5`) for bulk categorization, with structured JSON output. A larger model only if you can justify it.

## Security and privacy requirements (non-negotiable)

Design these in detail:

1. **Tenant isolation:** Every row carries `user_id`. Enforce isolation at the DB layer with Postgres Row-Level Security (or explain an equivalent guarantee), not only in application code. Show the RLS policies.
2. **Encryption at rest:**
   - Plaid access tokens: application-level **envelope encryption** (AES-256-GCM data keys wrapped by a KMS master key, e.g., AWS KMS or GCP KMS). Never log them.
   - Sensitive transaction fields (merchant name, description, amount, notes): decide whether to encrypt at the field level with a per-user data key. Explain the trade-off against the ability to run SQL aggregations for reports, and propose a solution (e.g., keep amounts/categories/dates queryable but encrypt descriptions, or aggregate in app memory).
   - Managed DB disk encryption as the baseline.
3. **Encryption in transit:** TLS everywhere, HSTS, secure cookies.
4. **Secrets management:** Environment variables via the host's secret store, key rotation plan, separate Plaid Sandbox / Development / Production keys.
5. **LLM data minimization:** Send only what categorization needs (merchant name, cleaned description, amount, date, Plaid's `personal_finance_category`, MCC if available). Never send account numbers, user names, emails, or balances. Mention Anthropic data-retention and zero-data-retention options.
6. **App security:** CSRF protection, input validation (Zod), rate limiting, Plaid webhook signature verification (JWT/JWK), audit log of sensitive actions, dependency scanning, CSP headers.
7. **User rights:** Disconnect a card (call Plaid `/item/remove` and delete its data), export all data (CSV/JSON), delete account (hard delete plus key destruction, i.e. crypto-shredding).
8. **Compliance notes:** Plaid production access requirements and security questionnaire, privacy policy/ToS needs, and whether GLBA/CCPA/GDPR concerns apply to a small app. Flag these; don't give legal advice.

## Plaid integration details to cover

- Products: `transactions` (credit cards come through here), and optionally `/transactions/recurring/get` to detect subscriptions like streaming services.
- Use **`/transactions/sync`** with a stored cursor per Item, not `/transactions/get`.
- Webhooks: `SYNC_UPDATES_AVAILABLE`, `ITEM_LOGIN_REQUIRED`/`ERROR`, `PENDING_EXPIRATION`, `USER_PERMISSION_REVOKED`. Describe the handler and the **update mode** re-auth flow.
- Handle added, modified, and removed transactions, and pending → posted transitions (don't double count).
- **Sign convention:** Plaid amounts are positive for money out. Define how refunds, credits, and **credit card payments** are handled so card payments aren't counted as spending (and aren't double counted if a checking account is linked later).
- Initial history backfill (how many days to request) and Plaid pricing implications per connected Item.
- Sandbox → Trial plan (free, up to 10 real Items) → Full Production rollout.

## AI categorization design to cover

- **Pipeline:** new or modified transaction → rules and cache check → LLM (batched, e.g., 25–50 transactions per call) → validate the JSON against the category enum → store category, confidence, source (`rule` | `cache` | `llm` | `user`).
- **Cost control:** a merchant-level cache (normalized merchant → category per user) so the same merchant isn't re-sent to the LLM; use Plaid's `personal_finance_category` as a strong hint or a skip condition when confidence is high; prompt caching for the system prompt.
- **Learning from corrections:** when a user re-labels, create or update a per-user rule (merchant → category) and optionally re-label past matching transactions. Include recent user corrections as few-shot examples.
- **Taxonomy:** a fixed default category set plus user-defined custom tags. Distinguish a *category* (one per transaction) from *tags* (many, e.g., "Vacation – Japan 2026" spanning flights, hotels, and dining). Recommend how trips/vacations should be grouped (date-range tagging suggestions from the LLM?).
- **Subscriptions:** detect recurring charges (Plaid recurring endpoint plus a heuristic) and label them "Subscription" with a cadence.
- Provide the **actual system prompt and JSON schema** for the categorization call, and describe failure handling (retries, fallback to "Uncategorized", low-confidence review queue in the UI).

## Reporting and income to cover

- Income model: recurring income (amount, frequency, start date) and one-off entries; optionally detect deposits later if a checking account is linked.
- Monthly rollup: for each month → total spend, spend by category, spend by card, total income, **net = income − spend**, savings rate.
- Time range selector (past N months), comparison with the prior period, top merchants, largest transactions.
- Decide between computing on the fly with SQL and materialized monthly summaries, given the encryption choices above.
- Timezone handling (user's local month boundaries) and currency (assume USD for v1, but don't paint into a corner).
- Charts: pick a library (e.g., Recharts or Tremor) and list the charts per screen.

## Deliverables: structure your answer exactly like this

1. **Architecture overview:** a diagram (Mermaid) of browser, Next.js server, Postgres, Plaid, LLM, job queue, KMS, plus a 1-paragraph explanation.
2. **Tech stack table:** layer | choice | why | alternative.
3. **Data model:** full Postgres schema (Drizzle or SQL DDL) for users, plaid_items, accounts, transactions, categories, user_category_rules, tags, transaction_tags, income_entries, sync_cursors, audit_log, and anything else needed. Mark encrypted columns and indexes. Include RLS policies.
4. **Security design:** key hierarchy, encryption/decryption flow, threat model table (threat | mitigation), and what happens if the DB is leaked.
5. **Plaid flows:** sequence diagrams (Mermaid) for connecting a card, webhook-driven sync, and re-auth.
6. **Categorization pipeline:** diagram, prompt, JSON schema, batching and caching logic, cost estimate per 1,000 transactions.
7. **API surface:** list of Route Handlers / Server Actions with method, path, auth requirement, and purpose.
8. **Pages and UX:** sitemap and wireframe-level description of each screen (Onboarding/Connect, Dashboard, Transactions with filters and inline re-labeling, Reports, Income, Settings/Security/Data export).
9. **Project folder structure** for the Next.js app.
10. **Environment variables and third-party accounts** needed, with setup steps.
11. **Phased roadmap:** MVP (Sandbox, single user flow, end to end) → v1 (production Plaid, reports, income) → v2 (budgets, alerts, trip auto-detection, mobile PWA). Give each phase concrete, checkable tasks.
12. **Testing strategy:** unit tests (categorization parsing, report math), integration tests with Plaid Sandbox, security tests (tenant-isolation tests proving user A can't read user B's data), and E2E tests (Playwright).
13. **Cost estimate:** monthly cost for 1, 100, and 1,000 users (Plaid, hosting, DB, LLM, KMS).
14. **Open questions and risks:** anything I need to decide or that could block launch.

Keep the plan concrete and specific to this app. Avoid generic advice.
