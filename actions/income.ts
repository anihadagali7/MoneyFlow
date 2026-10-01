"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getKeyProvider } from "@/lib/crypto/keyProvider";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { withUser } from "@/lib/db";
import { incomeEntries, incomeSources } from "@/lib/db/schema";
import { allow } from "@/lib/guard";
import { toCents } from "@/lib/money";
import { RateLimitError } from "@/lib/rate-limit";
import { INCOME_FREQUENCIES } from "@/lib/reports/income";
import { addPayerAsIncome, dismissPayer } from "@/lib/income/suggest";
import { loadUserContext } from "@/lib/user";

export type IncomeActionResult = { ok: true } | { ok: false; error: string };

const isoDate = z.iso.date({ error: "Use a valid date" });
const amount = z.coerce
  .number({ error: "Enter an amount" })
  .positive("Amount must be more than $0")
  .max(10_000_000, "That amount looks too large");
const label = z.string().trim().min(1, "Add a name").max(80);

const SourceInput = z
  .object({
    id: z.uuid().optional(),
    label,
    amount,
    frequency: z.enum(INCOME_FREQUENCIES),
    anchorDate: isoDate,
    endDate: isoDate.optional().or(z.literal("")),
  })
  .refine((v) => !v.endDate || v.endDate >= v.anchorDate, {
    message: "End date must be after the first pay date",
    path: ["endDate"],
  });

const EntryInput = z.object({ id: z.uuid().optional(), label, amount, receivedOn: isoDate });

function firstError(err: z.ZodError) {
  return err.issues[0]?.message ?? "Please check the form";
}

function refresh() {
  revalidatePath("/income");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
}

export async function saveIncomeSource(input: z.input<typeof SourceInput>): Promise<IncomeActionResult> {
  const userId = await requireUser();
  if (!(await allow(userId, "income.save"))) return { ok: false, error: new RateLimitError().message };
  const parsed = SourceInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;
  const found = await withUser(userId, async (tx) => {
    const crypto = await loadUserCrypto(tx, getKeyProvider(), userId);
    const values = {
      labelCt: crypto.encrypt("income_sources", "label_ct", v.label),
      amountCents: toCents(v.amount),
      frequency: v.frequency,
      anchorDate: v.anchorDate,
      endDate: v.endDate || null,
    };
    if (v.id) {
      const updated = await tx
        .update(incomeSources)
        .set({ ...values, origin: "manual" })
        .where(eq(incomeSources.id, v.id))
        .returning();
      return updated.length > 0;
    }
    await tx.insert(incomeSources).values({ userId, ...values });
    return true;
  });
  if (!found) return { ok: false, error: "Income source not found" };
  refresh();
  return { ok: true };
}

/** Adds a payer from "Deposits that look like pay" as income. */
export async function addPayCandidate(key: string): Promise<IncomeActionResult> {
  const userId = await requireUser();
  if (!(await allow(userId, "income.save"))) return { ok: false, error: new RateLimitError().message };
  const payer = z
    .string()
    .regex(/^[0-9a-f]{16,128}$/)
    .safeParse(key);
  if (!payer.success) return { ok: false, error: "Deposit not found" };
  const added = await withUser(userId, async (tx) => {
    const { crypto, today } = await loadUserContext(tx, userId);
    return addPayerAsIncome(tx, crypto, payer.data, today.iso);
  });
  if (!added) return { ok: false, error: "Deposit not found" };
  refresh();
  return { ok: true };
}

export async function deleteIncomeSource(id: string): Promise<IncomeActionResult> {
  const userId = await requireUser();
  await removeSource(userId, z.uuid().parse(id));
  refresh();
  return { ok: true };
}

export async function saveIncomeEntry(input: z.input<typeof EntryInput>): Promise<IncomeActionResult> {
  const userId = await requireUser();
  if (!(await allow(userId, "income.save"))) return { ok: false, error: new RateLimitError().message };
  const parsed = EntryInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;
  const found = await withUser(userId, async (tx) => {
    const crypto = await loadUserCrypto(tx, getKeyProvider(), userId);
    const values = {
      labelCt: crypto.encrypt("income_entries", "label_ct", v.label),
      amountCents: toCents(v.amount),
      receivedOn: v.receivedOn,
    };
    if (v.id) {
      const updated = await tx.update(incomeEntries).set(values).where(eq(incomeEntries.id, v.id)).returning();
      return updated.length > 0;
    }
    await tx.insert(incomeEntries).values({ userId, ...values });
    return true;
  });
  if (!found) return { ok: false, error: "Income entry not found" };
  refresh();
  return { ok: true };
}

export async function deleteIncomeEntry(id: string): Promise<IncomeActionResult> {
  const userId = await requireUser();
  await withUser(userId, (tx) => tx.delete(incomeEntries).where(eq(incomeEntries.id, z.uuid().parse(id))));
  refresh();
  return { ok: true };
}

/**
 * Deleting income that was detected from deposits also stops detecting that payer;
 * otherwise it would come straight back on the next sync.
 */
async function removeSource(userId: string, id: string) {
  await withUser(userId, async (tx) => {
    const [source] = await tx.select().from(incomeSources).where(eq(incomeSources.id, id));
    if (!source) return;
    if (source.origin === "detected" && source.merchantHash) {
      await dismissPayer(tx, (await loadUserContext(tx, userId)).crypto, source.merchantHash);
    } else {
      await tx.delete(incomeSources).where(eq(incomeSources.id, id));
    }
  });
}
