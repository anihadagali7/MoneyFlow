import { asc } from "drizzle-orm";
import type { UserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import {
  accounts,
  budgets,
  categories,
  goalContributions,
  incomeEntries,
  incomeSources,
  plaidItems,
  recurringStreams,
  savingsGoals,
  tags,
  transactions,
  transactionTags,
} from "@/lib/db/schema";

/**
 * Everything the user has in MoneyFlow, decrypted, for download. Merchant rules are left out:
 * they're keyed by a one-way hash of the merchant, so there's no name to export.
 */
export async function buildExport(tx: Tx, crypto: UserCrypto) {
  const [items, accountRows, categoryRows, txnRows, tagRows, tagLinks, sources, entries, budgetRows, goalRows, contributionRows, streamRows] =
    await Promise.all([
      tx.select().from(plaidItems),
      tx.select().from(accounts),
      tx.select().from(categories),
      tx.select().from(transactions).orderBy(asc(transactions.date)),
      tx.select().from(tags),
      tx.select().from(transactionTags),
      tx.select().from(incomeSources),
      tx.select().from(incomeEntries).orderBy(asc(incomeEntries.receivedOn)),
      tx.select().from(budgets),
      tx.select().from(savingsGoals).orderBy(asc(savingsGoals.createdAt)),
      tx.select().from(goalContributions).orderBy(asc(goalContributions.date)),
      tx.select().from(recurringStreams),
    ]);
  const categoryName = new Map(categoryRows.map((c) => [c.id, c.name]));
  const tagName = new Map(tagRows.map((t) => [t.id, crypto.decrypt("tags", "name_ct", t.nameCt)]));
  const accountLabel = new Map(
    accountRows.map((a) => [
      a.id,
      `${crypto.decrypt("accounts", "name_ct", a.nameCt)}${a.maskCt ? ` ${crypto.decrypt("accounts", "mask_ct", a.maskCt)}` : ""}`,
    ]),
  );

  return {
    exportedAt: new Date().toISOString(),
    banks: items.map((i) => ({ institution: i.institutionName, status: i.status, connectedAt: i.createdAt })),
    cards: accountRows.map((a) => ({ id: a.id, name: accountLabel.get(a.id), type: a.type, subtype: a.subtype })),
    transactions: txnRows.map((t) => ({
      date: t.date,
      merchant: crypto.decryptOrNull("transactions", "merchant_name_ct", t.merchantNameCt),
      description: crypto.decrypt("transactions", "description_ct", t.descriptionCt),
      amount: t.amountCents / 100,
      currency: t.isoCurrency,
      category: t.categoryId ? categoryName.get(t.categoryId) ?? null : null,
      categorySource: t.categorySource,
      card: accountLabel.get(t.accountId) ?? null,
      pending: t.pending,
      notes: crypto.decryptOrNull("transactions", "notes_ct", t.notesCt),
      tags: tagLinks.filter((l) => l.transactionId === t.id).map((l) => tagName.get(l.tagId)),
    })),
    income: {
      recurring: sources.map((s) => ({
        name: crypto.decrypt("income_sources", "label_ct", s.labelCt),
        amount: s.amountCents / 100,
        frequency: s.frequency,
        firstPayDate: s.anchorDate,
        endDate: s.endDate,
      })),
      oneTime: entries.map((e) => ({
        name: crypto.decrypt("income_entries", "label_ct", e.labelCt),
        amount: e.amountCents / 100,
        receivedOn: e.receivedOn,
      })),
    },
    customCategories: categoryRows.filter((c) => c.userId !== null).map((c) => ({ name: c.name, slug: c.slug })),
    budgets: budgetRows.map((b) => ({
      category: b.categoryId ? categoryName.get(b.categoryId) ?? null : "Total spending",
      monthlyLimit: b.amountCents / 100,
    })),
    savingsGoals: goalRows.map((g) => ({
      name: crypto.decrypt("savings_goals", "name_ct", g.nameCt),
      target: g.targetCents / 100,
      targetDate: g.targetDate,
      linkedAccount: g.accountId ? accountLabel.get(g.accountId) ?? null : null,
      contributions: contributionRows
        .filter((c) => c.goalId === g.id)
        .map((c) => ({
          date: c.date,
          amount: c.amountCents / 100,
          note: crypto.decryptOrNull("goal_contributions", "note_ct", c.noteCt),
        })),
    })),
    trips: tagRows
      .filter((t) => t.kind === "trip")
      .map((t) => ({ name: tagName.get(t.id), startsOn: t.startsOn, endsOn: t.endsOn })),
    subscriptions: streamRows
      .filter((s) => !s.dismissed)
      .map((s) => ({
        merchant: crypto.decryptOrNull("recurring_streams", "merchant_ct", s.merchantCt),
        frequency: s.frequency,
        lastAmount: s.lastAmountCents === null ? null : s.lastAmountCents / 100,
        lastDate: s.lastDate,
        nextDate: s.nextDate,
        active: s.isActive,
        category: s.categoryId ? categoryName.get(s.categoryId) ?? null : null,
      })),
  };
}

/** One CSV field. Text starting with = + - @ is prefixed so spreadsheets don't run it as a formula. */
export function csvField(value: unknown, text = true): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function transactionsCsv(data: Awaited<ReturnType<typeof buildExport>>): string {
  const header = ["Date", "Merchant", "Description", "Amount", "Category", "Card", "Pending", "Notes", "Tags"];
  const lines = data.transactions.map((t) =>
    [
      csvField(t.date, false),
      csvField(t.merchant),
      csvField(t.description),
      csvField(t.amount.toFixed(2), false),
      csvField(t.category),
      csvField(t.card),
      csvField(t.pending ? "yes" : "no", false),
      csvField(t.notes),
      csvField(t.tags.join("; ")),
    ].join(","),
  );
  // BOM so Excel opens UTF-8 correctly.
  return "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
}

