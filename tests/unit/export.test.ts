import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { runAsUser, type Db } from "@/lib/db/core";
import { budgets, categories, recurringStreams } from "@/lib/db/schema";
import { buildExport, csvField, transactionsCsv } from "@/lib/export";
import { addContribution, createGoal } from "@/lib/goals";
import { createTrip } from "@/lib/trips";
import { provider, seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

describe("csv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvField('Joe\'s "Diner", NYC')).toBe('"Joe\'s ""Diner"", NYC"');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
    expect(csvField(null)).toBe("");
  });

  it("neutralizes spreadsheet formulas in text but not in amounts", () => {
    expect(csvField("=HYPERLINK(\"http://evil\")")).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvField("-12.50", false)).toBe("-12.50");
  });

  it("writes a header and one row per transaction", () => {
    const csv = transactionsCsv({
      transactions: [
        { date: "2026-09-01", merchant: "Netflix", description: "NETFLIX.COM", amount: 15.49, category: "Streaming", card: "Venture 4821", pending: false, notes: null, tags: [] },
      ],
    } as never);
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe("Date,Merchant,Description,Amount,Category,Card,Pending,Notes,Tags");
    expect(lines[1]).toBe("2026-09-01,Netflix,NETFLIX.COM,15.49,Streaming,Venture 4821,no,,");
  });
});

describe("buildExport", () => {
  const U = "user_export";
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    await seedUserWithItem(db, U);
  });
  afterEach(() => close());

  it("includes budgets, goals with their history, trips and subscriptions", async () => {
    const data = await runAsUser(db, U, async (tx) => {
      const crypto = await loadUserCrypto(tx, provider, U);
      const [dining] = await tx.select().from(categories).where(eq(categories.slug, "dining"));
      await tx.insert(budgets).values([
        { userId: U, categoryId: dining.id, amountCents: 300_50 },
        { userId: U, categoryId: null, amountCents: 2000_00 },
      ]);
      const today = { iso: "2026-09-30", month: { year: 2026, month: 9 } };
      const goal = await createGoal(tx, crypto, { name: "Japan", targetCents: 5000_00, targetDate: null, accountId: null, startingCents: 100_00 }, today);
      await addContribution(tx, crypto, goal, { amountCents: 50_00, date: "2026-09-30", note: "Payday" });
      await createTrip(tx, crypto, { name: "Lisbon", startsOn: "2026-06-01", endsOn: "2026-06-07", transactionIds: [] });
      await tx.insert(recurringStreams).values([
        { userId: U, merchantCt: crypto.encrypt("recurring_streams", "merchant_ct", "Netflix"), frequency: "monthly", lastAmountCents: 15_49 },
        { userId: U, merchantCt: crypto.encrypt("recurring_streams", "merchant_ct", "Gym"), dismissed: true },
      ]);
      return { ...(await buildExport(tx, crypto)), diningName: dining.name };
    });

    expect(data.budgets).toEqual(
      expect.arrayContaining([
        { category: data.diningName, monthlyLimit: 300.5 },
        { category: "Total spending", monthlyLimit: 2000 },
      ]),
    );
    expect(data.savingsGoals).toEqual([
      expect.objectContaining({
        name: "Japan",
        target: 5000,
        contributions: [
          expect.objectContaining({ amount: 100, note: "Starting amount" }),
          expect.objectContaining({ amount: 50, note: "Payday" }),
        ],
      }),
    ]);
    expect(data.trips).toEqual([{ name: "Lisbon", startsOn: "2026-06-01", endsOn: "2026-06-07" }]);
    expect(data.subscriptions.map((s) => s.merchant)).toEqual(["Netflix"]);
  });
});
