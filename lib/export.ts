import { asc } from "drizzle-orm";
import type { UserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import { accounts, categories, incomeEntries, incomeSources, plaidItems, tags, transactions, transactionTags } from "@/lib/db/schema";

/** Everything the user has in MoneyFlow, decrypted, for download. */
export async function buildExport(tx: Tx, crypto: UserCrypto) {
  const [items, accountRows, categoryRows, txnRows, tagRows, tagLinks, sources, entries] = await Promise.all([
    tx.select().from(plaidItems),
    tx.select().from(accounts),
    tx.select().from(categories),
    tx.select().from(transactions).orderBy(asc(transactions.date)),
    tx.select().from(tags),
    tx.select().from(transactionTags),
    tx.select().from(incomeSources),
    tx.select().from(incomeEntries).orderBy(asc(incomeEntries.receivedOn)),
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

