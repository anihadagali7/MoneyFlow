import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { runAsUser, type Db } from "@/lib/db/core";
import { syncItem } from "@/lib/plaid/sync";
import type { Today } from "@/lib/time";
import { loadTransactions } from "@/lib/views/data";
import { page, plaidTxn, provider, runner, seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

const U = "user_search";
const today: Today = { iso: "2026-09-20", month: { year: 2026, month: 9 } };
let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const item = await seedUserWithItem(db, U);
  const pages = [
    page({
      next_cursor: "c1",
      added: [
        plaidTxn({ transaction_id: "n1", date: "2026-09-10", amount: 17.99, merchant_name: "Netflix" }),
        plaidTxn({ transaction_id: "n2", date: "2026-03-10", amount: 15.49, merchant_name: "Netflix" }),
        plaidTxn({ transaction_id: "n3", date: "2025-11-10", amount: 15.49, merchant_name: "Netflix" }),
        plaidTxn({ transaction_id: "old", date: "2023-01-10", amount: 9.99, merchant_name: "Netflix" }), // > 2 years
        plaidTxn({ transaction_id: "s1", date: "2026-06-01", amount: 11.99, merchant_name: "Spotify" }),
      ],
    }),
  ];
  await syncItem({ run: runner(db), fetchPage: async () => pages.shift()!, provider }, U, item.id);
});
afterEach(() => close());

const load = (filters: Record<string, string>) =>
  runAsUser(db, U, async (tx) => loadTransactions(tx, await loadUserCrypto(tx, provider, U), filters, today));

describe("search", () => {
  it("finds matches in every month of the last 2 years, ignoring the selected month", async () => {
    const data = await load({ q: "netflix", month: "2026-06" });
    expect(data.searching).toBe(true);
    expect(data.rows.map((r) => r.date)).toEqual(["2026-09-10", "2026-03-10", "2025-11-10"]);
    expect(data.totals.outCents).toBe(17_99 + 15_49 + 15_49);
  });

  it("matches exact amounts", async () => {
    expect((await load({ q: "15.49" })).rows).toHaveLength(2);
  });

  it("without a search, shows only the selected month", async () => {
    const data = await load({ month: "2026-06" });
    expect(data.searching).toBe(false);
    expect(data.rows.map((r) => r.merchant)).toEqual(["Spotify"]);
  });
});
