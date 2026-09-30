import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { UserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import { accounts, categories, incomeSources, plaidItems, tags, transactions } from "@/lib/db/schema";
import type { IncomeFrequency } from "@/lib/reports/income";
import { shiftDays } from "@/lib/trips/detect";
import { median } from "@/lib/subscriptions/detect";
import { detectPaycheck, explainDeposits } from "./detect";

const DISMISSED = "income_dismissed"; // tags row; name_ct holds the payer's blind-index key
const ACTIVE_DAYS = 45; // a paycheck not seen for ~6 weeks has stopped
const LOOKBACK_DAYS = 400;

/**
 * Deposits into checking/savings that could be pay: money in, not a transfer or card payment.
 * `labelledOnly` skips deposits the categorizer hasn't seen yet (they might be transfers).
 */
function depositFilter(since: string, labelledOnly = false) {
  return and(
    eq(accounts.type, "depository"),
    lt(transactions.amountCents, 0),
    eq(transactions.pending, false),
    isNotNull(transactions.merchantHash),
    gte(transactions.date, since),
    labelledOnly ? eq(categories.kind, "income") : or(isNull(categories.kind), eq(categories.kind, "income")),
  );
}

type Payer = {
  hash: Buffer;
  key: string;
  name: string;
  frequency: IncomeFrequency;
  amountCents: number;
  firstDate: string;
  lastDate: string;
};

type DepositGroup = {
  hash: Buffer;
  key: string;
  name: string;
  deposits: Array<{ date: string; amountCents: number }>; // positive amounts, newest first
};

/** Deposits from the last ~13 months, grouped by payer. */
async function depositGroups(
  tx: Tx,
  crypto: UserCrypto,
  today: string,
  labelledOnly: boolean,
): Promise<DepositGroup[]> {
  const rows = await tx
    .select({
      merchantHash: transactions.merchantHash,
      date: transactions.date,
      amountCents: transactions.amountCents,
      merchantNameCt: transactions.merchantNameCt,
      descriptionCt: transactions.descriptionCt,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(depositFilter(shiftDays(today, -LOOKBACK_DAYS), labelledOnly))
    .orderBy(desc(transactions.date));

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.merchantHash!.toString("hex");
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups].map(([key, deposits]) => {
    const latest = deposits[0];
    return {
      hash: latest.merchantHash!,
      key,
      name:
        crypto.decryptOrNull("transactions", "merchant_name_ct", latest.merchantNameCt) ??
        crypto.decrypt("transactions", "description_ct", latest.descriptionCt),
      deposits: deposits.map((d) => ({ date: d.date, amountCents: -d.amountCents })),
    };
  });
}

async function detectPayers(tx: Tx, crypto: UserCrypto, today: string, labelledOnly: boolean): Promise<Payer[]> {
  const payers: Payer[] = [];
  for (const g of await depositGroups(tx, crypto, today, labelledOnly)) {
    const pattern = detectPaycheck(g.deposits);
    if (!pattern) continue;
    payers.push({
      hash: g.hash,
      key: g.key,
      name: g.name,
      frequency: pattern.frequency,
      amountCents: pattern.amountCents,
      firstDate: g.deposits[g.deposits.length - 1].date,
      lastDate: pattern.lastDate,
    });
  }
  return payers;
}

export type PayCandidate = {
  key: string;
  name: string;
  count: number;
  typicalCents: number;
  lastDate: string;
  frequency: IncomeFrequency;
  /** Why it wasn't added automatically. */
  reason: string;
};

/**
 * Repeated deposits that aren't income yet, biggest first, with the reason detection
 * passed on them, so the user can add pay the automatic check missed.
 */
export async function listPayCandidates(tx: Tx, crypto: UserCrypto, today: string, limit = 5): Promise<PayCandidate[]> {
  const [groups, sources, dismissedRows] = await Promise.all([
    depositGroups(tx, crypto, today, false),
    tx.select({ hash: incomeSources.merchantHash }).from(incomeSources),
    tx.select({ nameCt: tags.nameCt }).from(tags).where(eq(tags.kind, DISMISSED)),
  ]);
  const taken = new Set(sources.filter((s) => s.hash).map((s) => s.hash!.toString("hex")));
  for (const r of dismissedRows) taken.add(crypto.decrypt("tags", "name_ct", r.nameCt));
  const total = (g: DepositGroup) => g.deposits.reduce((a, d) => a + d.amountCents, 0);
  return (
    groups
      // Pay that fits a schedule is added (or already covered) by syncDetectedIncome.
      .filter((g) => !taken.has(g.key) && g.deposits.length >= 2 && !detectPaycheck(g.deposits))
      .sort((a, b) => total(b) - total(a))
      .slice(0, limit)
      .map((g) => ({
        key: g.key,
        name: g.name,
        count: g.deposits.length,
        typicalCents: median(g.deposits.map((d) => d.amountCents)),
        lastDate: g.deposits[0].date,
        ...explainDeposits(g.deposits),
      }))
  );
}

/**
 * Adds a payer as income by hand. It's stored like detected income, so reports count the
 * actual deposits, and it keeps following the deposits if they later fit a schedule.
 */
export async function addPayerAsIncome(tx: Tx, crypto: UserCrypto, key: string, today: string): Promise<boolean> {
  const group = (await depositGroups(tx, crypto, today, false)).find((g) => g.key === key);
  if (!group) return false;
  const pattern = detectPaycheck(group.deposits);
  const latest = group.deposits[0];
  const active = latest.date >= shiftDays(today, -ACTIVE_DAYS);
  await tx
    .insert(incomeSources)
    .values({
      userId: crypto.userId,
      labelCt: crypto.encrypt("income_sources", "label_ct", group.name),
      amountCents: latest.amountCents,
      frequency: pattern?.frequency ?? explainDeposits(group.deposits).frequency,
      anchorDate: latest.date,
      endDate: active ? null : latest.date,
      origin: "detected",
      merchantHash: group.hash,
    })
    .onConflictDoNothing();
  return true;
}

/**
 * Keeps income sources in step with regular deposits that look like pay:
 * - a new payer becomes a "detected" income source automatically, including pay that has
 *   since stopped (e.g. found in imported history), so past months count it;
 * - an existing detected source follows the latest amount and schedule;
 * - one whose deposits stopped gets an end date (so it stops projecting);
 * - payers the user dismissed, or already covered by income they entered, are left alone.
 * With `labelledOnly` (before the categorizer has run) it only adds pay already labelled
 * as income and leaves existing sources as they are. Returns how many sources were created.
 */
export async function syncDetectedIncome(
  tx: Tx,
  crypto: UserCrypto,
  today: string,
  { labelledOnly = false }: { labelledOnly?: boolean } = {},
): Promise<number> {
  const [payers, sources, dismissedRows] = await Promise.all([
    detectPayers(tx, crypto, today, labelledOnly),
    tx.select().from(incomeSources),
    tx.select({ nameCt: tags.nameCt }).from(tags).where(eq(tags.kind, DISMISSED)),
  ]);
  const dismissed = new Set(dismissedRows.map((r) => crypto.decrypt("tags", "name_ct", r.nameCt)));
  const byHash = new Map(sources.filter((s) => s.merchantHash).map((s) => [s.merchantHash!.toString("hex"), s]));
  const manual = sources.filter((s) => s.origin === "manual" && !s.merchantHash);

  let created = 0;
  for (const p of payers) {
    if (dismissed.has(p.key)) continue;
    const active = p.lastDate >= shiftDays(today, -ACTIVE_DAYS);
    const existing = byHash.get(p.key);
    if (existing) {
      // The user edited it (now manual): leave it alone.
      if (existing.origin !== "detected" || labelledOnly) continue;
      await tx
        .update(incomeSources)
        .set({
          labelCt: crypto.encrypt("income_sources", "label_ct", p.name),
          amountCents: p.amountCents,
          frequency: p.frequency,
          anchorDate: p.lastDate,
          endDate: active ? null : p.lastDate,
        })
        .where(eq(incomeSources.id, existing.id));
      continue;
    }
    // Income the user already entered by hand for this pay: same schedule, amount within
    // 10%, and running during the time these deposits came in.
    const until = active ? today : p.lastDate;
    const covered = manual.some(
      (s) =>
        s.frequency === p.frequency &&
        s.anchorDate <= until &&
        (!s.endDate || s.endDate >= p.firstDate) &&
        Math.abs(s.amountCents - p.amountCents) <= p.amountCents * 0.1,
    );
    if (covered) continue;
    await tx.insert(incomeSources).values({
      userId: crypto.userId,
      labelCt: crypto.encrypt("income_sources", "label_ct", p.name),
      amountCents: p.amountCents,
      frequency: p.frequency,
      anchorDate: p.lastDate,
      endDate: active ? null : p.lastDate,
      origin: "detected",
      merchantHash: p.hash,
    });
    created++;
  }
  return created;
}

/**
 * Actual deposits per "YYYY-MM" from the payers behind detected income sources. Reports use
 * these instead of the schedule, so raises, bonuses and three-paycheck months are exact.
 */
export async function detectedDepositsByMonth(tx: Tx, from: string, to: string): Promise<Map<string, number>> {
  const detected = await tx
    .select({ hash: incomeSources.merchantHash })
    .from(incomeSources)
    .where(and(eq(incomeSources.origin, "detected"), isNotNull(incomeSources.merchantHash)));
  if (detected.length === 0) return new Map();
  const rows = await tx
    .select({ date: transactions.date, amountCents: transactions.amountCents })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        depositFilter(from),
        lt(transactions.date, to),
        inArray(
          transactions.merchantHash,
          detected.map((d) => d.hash!),
        ),
      ),
    );
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.date.slice(0, 7), (totals.get(r.date.slice(0, 7)) ?? 0) - r.amountCents);
  return totals;
}

/** The bank each detected payer deposits into, for "From Chase deposits". */
export async function payerBanks(tx: Tx, hashes: Buffer[]): Promise<Map<string, string>> {
  if (hashes.length === 0) return new Map();
  const rows = await tx
    .select({ hash: transactions.merchantHash, bank: plaidItems.institutionName })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .innerJoin(plaidItems, eq(plaidItems.id, accounts.itemId))
    .where(and(inArray(transactions.merchantHash, hashes), lt(transactions.amountCents, 0)))
    .orderBy(desc(transactions.date));
  const banks = new Map<string, string>();
  for (const r of rows) {
    const key = r.hash!.toString("hex");
    if (!banks.has(key) && r.bank) banks.set(key, r.bank);
  }
  return banks;
}

/** "Not income": stop detecting this payer and remove its detected source. */
export async function dismissPayer(tx: Tx, crypto: UserCrypto, hash: Buffer) {
  await tx.insert(tags).values({
    userId: crypto.userId,
    kind: DISMISSED,
    nameCt: crypto.encrypt("tags", "name_ct", hash.toString("hex")),
  });
  await tx.delete(incomeSources).where(and(eq(incomeSources.merchantHash, hash), eq(incomeSources.origin, "detected")));
}
