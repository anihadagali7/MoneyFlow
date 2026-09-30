import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { runAsUser, type Db } from "@/lib/db/core";
import { accounts } from "@/lib/db/schema";
import {
  addContribution,
  createGoal,
  deleteContribution,
  GoalError,
  loadGoalContributions,
  loadGoals,
} from "@/lib/goals";
import { syncItem, type SyncPage } from "@/lib/plaid/sync";
import type { Today } from "@/lib/time";
import { card, page, provider, runner, seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

const U = "user_goals";
const today: Today = { iso: "2026-09-30", month: { year: 2026, month: 9 } };
const savings = {
  ...card,
  account_id: "sav",
  name: "Savings",
  official_name: "360 Savings",
  mask: "7710",
  type: "depository",
  subtype: "savings",
  balances: { available: 3200, current: 3200, limit: null, iso_currency_code: "USD", unofficial_currency_code: null },
} as unknown as SyncPage["accounts"][number];
let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const item = await seedUserWithItem(db, U);
  const pages = [page({ next_cursor: "c1", accounts: [card, savings] })];
  await syncItem({ run: runner(db), fetchPage: async () => pages.shift()!, provider }, U, item.id);
});
afterEach(() => close());

const ctx = <T>(
  fn: (
    tx: Parameters<Parameters<typeof runAsUser>[2]>[0],
    crypto: Awaited<ReturnType<typeof loadUserCrypto>>,
  ) => Promise<T>,
) => runAsUser(db, U, async (tx) => fn(tx, await loadUserCrypto(tx, provider, U)));

describe("savings goals", () => {
  it("tracks a manual goal from its starting amount and deposits", async () => {
    const id = await ctx((tx, c) =>
      createGoal(
        tx,
        c,
        { name: "Japan 2027", targetCents: 5000_00, targetDate: "2027-06-01", accountId: null, startingCents: 1000_00 },
        today,
      ),
    );
    await ctx((tx, c) => addContribution(tx, c, id, { amountCents: 400_00, date: "2026-09-15", note: "September" }));
    const { goals } = await ctx((tx, c) => loadGoals(tx, c, today));
    expect(goals[0]).toMatchObject({ name: "Japan 2027", savedCents: 1400_00, account: null });
    expect(goals[0].progress.remainingCents).toBe(3600_00);
    expect(goals[0].progress.projectedDate).not.toBeNull();

    const history = await ctx((tx, c) => loadGoalContributions(tx, c, id));
    expect(history.map((h) => h.note)).toEqual(["Starting amount", "September"]);
    // Newest first: removing the September deposit leaves the starting amount.
    await ctx((tx) => deleteContribution(tx, history[1].id));
    expect((await ctx((tx, c) => loadGoals(tx, c, today))).goals[0].savedCents).toBe(1000_00);
  });

  it("uses a linked savings account's balance as progress", async () => {
    const [sav] = await runAsUser(db, U, (tx) => tx.select().from(accounts).where(eq(accounts.plaidAccountId, "sav")));
    await ctx((tx, c) =>
      createGoal(tx, c, { name: "Emergency fund", targetCents: 10000_00, targetDate: null, accountId: sav.id }, today),
    );
    const data = await ctx((tx, c) => loadGoals(tx, c, today));
    expect(data.goals[0]).toMatchObject({ savedCents: 3200_00, account: { label: "360 Savings ••7710" } });
    expect(data.goals[0].progress.status).toBe("no_date");
    expect(data.savingsAccounts.map((a) => a.label)).toEqual(["360 Savings ••7710"]);
  });

  it("won't link a credit card as a savings account", async () => {
    const [cc] = await runAsUser(db, U, (tx) =>
      tx.select().from(accounts).where(eq(accounts.plaidAccountId, "acct-1")),
    );
    await expect(
      ctx((tx, c) =>
        createGoal(tx, c, { name: "Nope", targetCents: 100_00, targetDate: null, accountId: cc.id }, today),
      ),
    ).rejects.toThrow(GoalError);
  });
});
