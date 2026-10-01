import { and, count, desc, eq, gt, gte, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { UserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import { categories, transactions } from "@/lib/db/schema";
import { loadBudgets } from "@/lib/budgets";
import { loadGoals } from "@/lib/goals";
import { loadIncomeByMonth, spendByMonth } from "@/lib/reports/summary";
import { monthRange } from "@/lib/reports/spend";
import { loadSubscriptions } from "@/lib/subscriptions";
import type { Today } from "@/lib/time";
import { loadTrips } from "@/lib/trips";
import { shiftDays } from "@/lib/trips/detect";
import { loadItems } from "@/lib/views/data";
import { shortDate } from "@/lib/views/dates";

/**
 * Read-only tools the Ask assistant can call. Each runs inside the caller's withUser()
 * transaction, so Postgres row-level security limits it to that user's rows: the model
 * never writes queries and can't reach anyone else's data. Amounts go out in dollars.
 */

export type ToolContext = { tx: Tx; crypto: UserCrypto; today: Today };

const MAX_DAYS = 3 * 366;
const MAX_ROWS = 5000;
const dollars = (cents: number) => Math.round(cents) / 100;
const isoDate = z.iso.date({ error: "Use a real date as YYYY-MM-DD" });

/** Inclusive [start, end] dates → [from, to) for queries, kept to at most ~3 years. */
function period(start: string, end: string) {
  if (start > end) throw new ToolInputError("start_date must be on or before end_date");
  const to = shiftDays(end, 1);
  const from = start < shiftDays(to, -MAX_DAYS) ? shiftDays(to, -MAX_DAYS) : start;
  return { from, to, label: `${from} to ${end}` };
}

export class ToolInputError extends Error {}

/** "Aug 1 – Aug 31, 2026" (or with both years when they differ), for step labels. */
function span(start: string, end: string) {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${shortDate(start)}${sameYear ? "" : `, ${start.slice(0, 4)}`} – ${shortDate(end)}, ${end.slice(0, 4)}`;
}
const monthName = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** A category by slug or (case-insensitive) name, from the system list and the user's own. */
async function findCategory(tx: Tx, value: string) {
  const all = await tx.select().from(categories);
  const v = value.trim().toLowerCase();
  const match = all.find((c) => c.slug === v || c.name.toLowerCase() === v);
  if (!match) throw new ToolInputError(`Unknown category "${value}". Call list_categories for valid names.`);
  return match;
}

const merchantOf = (crypto: UserCrypto, r: { merchantNameCt: Buffer | null; descriptionCt: Buffer }) =>
  crypto.decryptOrNull("transactions", "merchant_name_ct", r.merchantNameCt) ??
  crypto.decrypt("transactions", "description_ct", r.descriptionCt);

// Spending: posted transactions in categories that count as spending (refunds net out).
const spendWhere = (from: string, to: string, categoryId?: string) =>
  and(
    gte(transactions.date, from),
    lt(transactions.date, to),
    eq(transactions.pending, false),
    eq(categories.countsAsSpend, true),
    categoryId ? eq(transactions.categoryId, categoryId) : undefined,
  );

const SpendingSummary = z.object({
  start_date: isoDate,
  end_date: isoDate,
  group_by: z.enum(["none", "category", "merchant", "month", "card"]).default("category"),
  category: z.string().max(80).optional(),
  limit: z.number().int().min(1).max(25).default(10),
});

async function spendingSummary(ctx: ToolContext, input: z.infer<typeof SpendingSummary>) {
  const { from, to, label } = period(input.start_date, input.end_date);
  const category = input.category ? await findCategory(ctx.tx, input.category) : null;
  // The total is exact; groups are built from the newest MAX_ROWS rows (merchant names need decrypting).
  const [[totals], rows] = await Promise.all([
    ctx.tx
      .select({
        cents: sql<number>`coalesce(sum(${transactions.amountCents}), 0)`.mapWith(Number),
        count: count(),
      })
      .from(transactions)
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .where(spendWhere(from, to, category?.id)),
    ctx.tx
      .select({
        date: transactions.date,
        amountCents: transactions.amountCents,
        accountId: transactions.accountId,
        merchantHash: transactions.merchantHash,
        merchantNameCt: transactions.merchantNameCt,
        descriptionCt: transactions.descriptionCt,
        category: categories.name,
      })
      .from(transactions)
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .where(spendWhere(from, to, category?.id))
      .orderBy(desc(transactions.date))
      .limit(MAX_ROWS),
  ]);

  const cards = input.group_by === "card" ? await cardLabels(ctx) : null;
  const groups = new Map<string, { name: string; cents: number; count: number }>();
  for (const r of rows) {
    const [key, name] =
      input.group_by === "category"
        ? [r.category, r.category]
        : input.group_by === "month"
          ? [r.date.slice(0, 7), r.date.slice(0, 7)]
          : input.group_by === "card"
            ? [r.accountId, cards!.get(r.accountId) ?? "Unknown account"]
            : input.group_by === "merchant"
              ? [r.merchantHash?.toString("hex") ?? r.descriptionCt.toString("hex"), ""]
              : ["all", "All spending"];
    const g = groups.get(key) ?? { name: name || merchantOf(ctx.crypto, r), cents: 0, count: 0 };
    g.cents += r.amountCents;
    g.count += 1;
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort((a, b) =>
    input.group_by === "month" ? a.name.localeCompare(b.name) : b.cents - a.cents,
  );
  const partial = input.group_by !== "none" && rows.length < totals.count;
  return {
    period: label,
    category: category?.name ?? "all spending categories",
    total_spent: dollars(totals.cents),
    transactions: totals.count,
    ...(partial
      ? {
          groups_note: `Groups cover only the newest ${rows.length} of ${totals.count} transactions; say so, or use a shorter period for a complete breakdown.`,
        }
      : {}),
    ...(input.group_by === "none"
      ? {}
      : {
          groups: sorted.slice(0, input.group_by === "month" ? 40 : input.limit).map((g) => ({
            name: g.name,
            spent: dollars(g.cents),
            transactions: g.count,
          })),
          more_groups: Math.max(0, sorted.length - (input.group_by === "month" ? 40 : input.limit)),
        }),
    note: "Spending excludes card payments, transfers and income; refunds are netted out.",
  };
}

const FindTransactions = z.object({
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
  search: z.string().max(80).optional(),
  category: z.string().max(80).optional(),
  direction: z.enum(["money_out", "money_in", "any"]).default("any"),
  min_amount: z.number().min(0).optional(),
  max_amount: z.number().min(0).optional(),
  sort: z.enum(["newest", "largest"]).default("newest"),
  limit: z.number().int().min(1).max(30).default(15),
});

async function findTransactions(ctx: ToolContext, input: z.infer<typeof FindTransactions>) {
  const end = input.end_date ?? ctx.today.iso;
  const start = input.start_date ?? shiftDays(end, -365);
  const { from, to, label } = period(start, end);
  const category = input.category ? await findCategory(ctx.tx, input.category) : null;
  const where: Array<SQL | undefined> = [
    gte(transactions.date, from),
    lt(transactions.date, to),
    category ? eq(transactions.categoryId, category.id) : undefined,
    input.direction === "money_out" ? gt(transactions.amountCents, 0) : undefined,
    input.direction === "money_in" ? lt(transactions.amountCents, 0) : undefined,
  ];
  const rows = await ctx.tx
    .select({
      date: transactions.date,
      pending: transactions.pending,
      amountCents: transactions.amountCents,
      accountId: transactions.accountId,
      merchantNameCt: transactions.merchantNameCt,
      descriptionCt: transactions.descriptionCt,
      category: categories.name,
      kind: categories.kind,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(...where))
    .orderBy(desc(transactions.date))
    .limit(MAX_ROWS);

  const cards = await cardLabels(ctx);
  const needle = input.search?.trim().toLowerCase();
  const matches = rows
    .map((r) => ({
      r,
      merchant: merchantOf(ctx.crypto, r),
      description: ctx.crypto.decrypt("transactions", "description_ct", r.descriptionCt),
    }))
    .filter(({ r, merchant, description }) => {
      const abs = Math.abs(r.amountCents) / 100;
      if (input.min_amount !== undefined && abs < input.min_amount) return false;
      if (input.max_amount !== undefined && abs > input.max_amount) return false;
      return !needle || merchant.toLowerCase().includes(needle) || description.toLowerCase().includes(needle);
    });
  if (input.sort === "largest") matches.sort((a, b) => Math.abs(b.r.amountCents) - Math.abs(a.r.amountCents));

  return {
    period: label,
    ...(rows.length === MAX_ROWS
      ? { note: `Only the newest ${MAX_ROWS} transactions in this period were searched; older matches may be missing.` }
      : {}),
    matching: matches.length,
    money_out_total: dollars(matches.reduce((a, m) => a + Math.max(0, m.r.amountCents), 0)),
    money_in_total: dollars(matches.reduce((a, m) => a + Math.max(0, -m.r.amountCents), 0)),
    transactions: matches.slice(0, input.limit).map(({ r, merchant }) => ({
      date: r.date,
      merchant,
      amount: dollars(Math.abs(r.amountCents)),
      direction: r.amountCents >= 0 ? "money out" : "money in",
      category: r.category ?? "Uncategorized",
      account: cards.get(r.accountId) ?? "",
      ...(r.kind === "transfer" ? { note: "transfer or card payment, not spending" } : {}),
      ...(r.pending ? { pending: true } : {}),
    })),
    shown: Math.min(matches.length, input.limit),
  };
}

const IncomeAndNet = z.object({
  start_month: z.string().regex(/^\d{4}-\d{2}$/),
  end_month: z.string().regex(/^\d{4}-\d{2}$/),
});

async function incomeAndNet(ctx: ToolContext, input: z.infer<typeof IncomeAndNet>) {
  const month = (s: string) => ({ year: +s.slice(0, 4), month: +s.slice(5, 7) });
  if (input.start_month > input.end_month) throw new ToolInputError("start_month must be on or before end_month");
  const { from } = monthRange(month(input.start_month));
  const { to } = monthRange(month(input.end_month));
  if (from < shiftDays(to, -MAX_DAYS)) throw new ToolInputError("Ask for at most 36 months at a time");
  const [spend, income] = await Promise.all([spendByMonth(ctx.tx, from, to), loadIncomeByMonth(ctx.tx, from, to)]);
  const months: Array<{ month: string; income: number; spending: number; net: number }> = [];
  for (let m = month(input.start_month); `${m.year}-${String(m.month).padStart(2, "0")}` <= input.end_month;) {
    const key = `${m.year}-${String(m.month).padStart(2, "0")}`;
    const i = income.get(key) ?? 0;
    const s = spend.get(key) ?? 0;
    months.push({ month: key, income: dollars(i), spending: dollars(s), net: dollars(i - s) });
    m = m.month === 12 ? { year: m.year + 1, month: 1 } : { year: m.year, month: m.month + 1 };
  }
  const sum = (k: "income" | "spending" | "net") => Math.round(months.reduce((a, m) => a + m[k], 0) * 100) / 100;
  return {
    months,
    totals: { income: sum("income"), spending: sum("spending"), net: sum("net") },
    note: "Income is paychecks found in bank deposits plus income the user entered. The current month is partial.",
  };
}

async function listCategories(ctx: ToolContext) {
  // Built-in categories plus the user's own (row-level security hides everyone else's).
  const rows = await ctx.tx
    .select({ slug: categories.slug, name: categories.name, kind: categories.kind })
    .from(categories);
  return { categories: rows.sort((a, b) => a.name.localeCompare(b.name)) };
}

async function budgets(ctx: ToolContext) {
  const b = await loadBudgets(ctx.tx, ctx.today);
  const view = (v: (typeof b.budgets)[number]) => ({
    name: v.name,
    limit: dollars(v.limitCents),
    spent: dollars(v.spentCents),
    left: dollars(v.limitCents - v.spentCents),
  });
  return {
    month: b.monthName,
    days_left: b.daysLeft,
    total_budget: b.total ? view(b.total) : null,
    budgets: b.budgets.map(view),
  };
}

async function subscriptions(ctx: ToolContext) {
  const s = await loadSubscriptions(ctx.tx, ctx.crypto, ctx.today);
  return {
    per_month: dollars(s.monthlyCents),
    per_year: dollars(s.yearlyCents),
    active: s.active.map((v) => ({
      name: v.name,
      amount: dollars(v.amountCents),
      frequency: v.frequencyLabel,
      per_month: dollars(v.monthlyCents),
      next_charge: v.nextDate,
      ...(v.priceIncrease ? { price_went_up_from: dollars(v.priceIncrease.fromCents) } : {}),
    })),
    stopped: s.stopped.map((v) => ({ name: v.name, last_charge: v.lastDate })),
  };
}

async function accountsAndGoals(ctx: ToolContext) {
  const [items, goals] = await Promise.all([loadItems(ctx.tx, ctx.crypto), loadGoals(ctx.tx, ctx.crypto, ctx.today)]);
  return {
    accounts: items.flatMap((i) =>
      i.cards
        .filter((c) => !c.removed)
        .map((c) => ({
          bank: i.institutionName,
          name: c.label,
          type: c.type === "credit" ? "credit card (balance is owed)" : (c.subtype ?? "bank account"),
          balance: c.balanceCents === null ? null : dollars(c.balanceCents),
          last_synced: i.lastSyncedAt?.slice(0, 10) ?? null,
        })),
    ),
    savings_goals: goals.goals.map((g) => ({
      name: g.name,
      target: dollars(g.targetCents),
      saved: dollars(g.savedCents),
      target_date: g.targetDate,
    })),
    average_monthly_net_last_3_months: dollars(goals.avgNetCents),
  };
}

async function trips(ctx: ToolContext) {
  const t = await loadTrips(ctx.tx, ctx.crypto, ctx.today);
  return {
    trips: t.trips.map((v) => ({
      name: v.name,
      dates: `${v.startsOn} to ${v.endsOn}`,
      total: dollars(v.totalCents),
      transactions: v.count,
      by_category: v.categories.map((c) => ({ name: c.name, spent: dollars(c.cents) })),
    })),
  };
}

async function cardLabels(ctx: ToolContext) {
  const items = await loadItems(ctx.tx, ctx.crypto);
  return new Map(items.flatMap((i) => i.cards.map((c) => [c.id, `${i.institutionName} ${c.label}`])));
}

type ToolDef = {
  description: string;
  schema: z.ZodType;
  run: (ctx: ToolContext, input: never) => Promise<unknown>;
  /** Short words for the "Looked at" list under an answer. */
  label: (input: never) => string;
};

const noInput = z.object({}).strict();

export const TOOLS = {
  spending_summary: {
    description:
      "Total spending for a date range, optionally for one category, grouped by category, merchant, month or card. Use for 'how much did I spend…', 'top merchants', 'biggest categories', month-by-month trends.",
    schema: SpendingSummary,
    run: spendingSummary,
    label: (i: z.infer<typeof SpendingSummary>) =>
      `Spending${i.category ? ` on ${i.category}` : ""}${i.group_by === "none" ? "" : ` by ${i.group_by}`}, ${span(i.start_date, i.end_date)}`,
  },
  find_transactions: {
    description:
      "Look up individual transactions by merchant/description text, category, direction, amount or date. Use for 'when did I last…', 'show my … charges', 'largest purchases'. Defaults to the last 12 months.",
    schema: FindTransactions,
    run: findTransactions,
    label: (i: z.infer<typeof FindTransactions>) =>
      `Transactions${i.search ? ` matching "${i.search}"` : ""}${i.category ? ` in ${i.category}` : ""}`,
  },
  income_and_net: {
    description: "Income, spending and net (income minus spending) per month, with totals. Months are YYYY-MM.",
    schema: IncomeAndNet,
    run: incomeAndNet,
    label: (i: z.infer<typeof IncomeAndNet>) =>
      `Income and net, ${monthName(i.start_month)} – ${monthName(i.end_month)}`,
  },
  list_categories: {
    description: "All category names (and slugs) the user's transactions can have.",
    schema: noInput,
    run: listCategories,
    label: () => "Category list",
  },
  budgets: {
    description: "This month's budgets: limit, spent so far and what's left, plus days left in the month.",
    schema: noInput,
    run: budgets,
    label: () => "This month's budgets",
  },
  subscriptions: {
    description:
      "Recurring charges (subscriptions and bills): amounts, frequency, next charge, totals per month and year.",
    schema: noInput,
    run: subscriptions,
    label: () => "Subscriptions",
  },
  accounts_and_goals: {
    description: "Linked cards and bank accounts with current balances, and savings goals with progress.",
    schema: noInput,
    run: accountsAndGoals,
    label: () => "Accounts and goals",
  },
  trips: {
    description: "Trips the user has set up, with dates, totals and spending by category.",
    schema: noInput,
    run: trips,
    label: () => "Trips",
  },
} satisfies Record<string, ToolDef>;

export type ToolName = keyof typeof TOOLS;

/** Validates the model's input and runs the tool. Bad input comes back as a ToolInputError. */
export async function runTool(ctx: ToolContext, name: string, input: unknown) {
  const tool = (TOOLS as Record<string, ToolDef>)[name];
  if (!tool) throw new ToolInputError(`Unknown tool ${name}`);
  const parsed = tool.schema.safeParse(input ?? {});
  if (!parsed.success)
    throw new ToolInputError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return { result: await tool.run(ctx, parsed.data as never), label: tool.label(parsed.data as never) };
}

/** Tool definitions in the shape the Messages API expects. */
export function toolSpecs() {
  return Object.entries(TOOLS).map(([name, t]) => {
    const schema = z.toJSONSchema(t.schema, { io: "input" }) as { type: "object"; [k: string]: unknown };
    delete schema.$schema;
    return { name, description: t.description, input_schema: schema };
  });
}
