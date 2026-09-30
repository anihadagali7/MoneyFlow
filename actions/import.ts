"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { allow } from "@/lib/guard";
import { applyImport, previewImport } from "@/lib/import";
import { ImportError, parseTransactionsCsv, type ImportRow } from "@/lib/import/csv";
import { categorizeForUser, checkBudgets, detectSubscriptions } from "@/lib/jobs";
import { loadUserContext } from "@/lib/user";

const MAX_CHARS = 1_500_000;

export type PreviewResult =
  | {
      ok: true;
      total: number;
      newCount: number;
      duplicates: number;
      skipped: number;
      from: string;
      to: string;
      spentCents: number;
      format: "debit_credit" | "typed" | "single";
      sample: ImportRow[];
    }
  | { ok: false; error: string };

function parse(text: string, flipSign: boolean) {
  if (text.length > MAX_CHARS) throw new ImportError("That file is too large. Download a shorter date range and try again.");
  return parseTransactionsCsv(text, flipSign);
}

/** Reads the file and reports what an import would add. Saves nothing. */
export async function previewCsvImport(accountId: string, text: string, flipSign: boolean): Promise<PreviewResult> {
  const userId = await requireUser();
  try {
    const parsed = parse(text, flipSign);
    const preview = await withUser(userId, (tx) => previewImport(tx, z.uuid().parse(accountId), parsed.rows));
    return {
      ok: true,
      total: preview.total,
      newCount: preview.newRows.length,
      duplicates: preview.duplicates,
      skipped: parsed.skipped,
      from: preview.from,
      to: preview.to,
      spentCents: preview.spentCents,
      format: parsed.format,
      sample: preview.newRows.slice(-5).reverse(),
    };
  } catch (err) {
    if (err instanceof ImportError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function importCsv(
  accountId: string,
  text: string,
  flipSign: boolean,
): Promise<{ ok: true; imported: number } | { ok: false; error: string }> {
  const userId = await requireUser();
  if (!(await allow(userId, "import"))) return { ok: false, error: "Too many imports. Try again in an hour." };
  try {
    const { rows } = parse(text, flipSign);
    const imported = await withUser(userId, async (tx) => {
      const { crypto } = await loadUserContext(tx, userId);
      return applyImport(tx, crypto, z.uuid().parse(accountId), rows);
    });
    // Label what rules and the cache didn't, then refresh what depends on history.
    after(async () => {
      await categorizeForUser(userId);
      await checkBudgets(userId);
      await detectSubscriptions(userId);
    });
    revalidatePath("/", "layout");
    return { ok: true, imported };
  } catch (err) {
    if (err instanceof ImportError) return { ok: false, error: err.message };
    throw err;
  }
}
