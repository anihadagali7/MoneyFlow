import type Anthropic from "@anthropic-ai/sdk";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askQuestion, OFF_TOPIC_REPLY } from "@/lib/ask";
import { runTool, ToolInputError, toolSpecs } from "@/lib/ask/tools";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { runAsUser, type Db } from "@/lib/db/core";
import { categories, transactions } from "@/lib/db/schema";
import { syncItem } from "@/lib/plaid/sync";
import type { Today } from "@/lib/time";
import { card, page, plaidTxn, provider, runner, seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

const U = "user_ask";
const V = "user_other";
const today: Today = { iso: "2026-09-20", month: { year: 2026, month: 9 } };
let db: Db;
let close: () => Promise<void>;

async function seed(userId: string, accountId: string, txns: Parameters<typeof plaidTxn>[0][]) {
  const item = await seedUserWithItem(db, userId);
  const pages = [
    page({
      next_cursor: "c1",
      accounts: [{ ...card, account_id: accountId }],
      added: txns.map((t) => plaidTxn({ ...t, account_id: accountId })),
    }),
  ];
  await syncItem({ run: runner(db), fetchPage: async () => pages.shift()!, provider }, userId, item.id);
}

async function label(userId: string, slug: string, ids: string[]) {
  await runAsUser(db, userId, async (tx) => {
    const [c] = await tx.select().from(categories).where(eq(categories.slug, slug));
    await tx
      .update(transactions)
      .set({ categoryId: c.id, categorySource: "user" })
      .where(inArray(transactions.plaidTransactionId, ids));
  });
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await seed(U, "acct-u", [
    { transaction_id: "d1", date: "2026-08-03", amount: 42.5, merchant_name: "Sushi Place" },
    { transaction_id: "d2", date: "2026-08-20", amount: 18, merchant_name: "Taco Stand" },
    { transaction_id: "d3", date: "2026-09-02", amount: 30, merchant_name: "Sushi Place" },
    { transaction_id: "g1", date: "2026-08-10", amount: 120.4, merchant_name: "Whole Foods" },
    { transaction_id: "r1", date: "2026-08-21", amount: -8, merchant_name: "Taco Stand" }, // refund
    { transaction_id: "n1", date: "2026-09-10", amount: 15.49, merchant_name: "Netflix" },
  ]);
  await label(U, "dining", ["d1", "d2", "d3", "r1"]);
  await label(U, "groceries", ["g1"]);
  await label(U, "subscriptions_streaming", ["n1"]);
  // Someone else's much bigger dining bill must never show up in U's answers.
  await seed(V, "acct-v", [{ transaction_id: "v1", date: "2026-08-05", amount: 9999, merchant_name: "Sushi Place" }]);
  await label(V, "dining", ["v1"]);
});
afterEach(() => close());

const tool = (name: string, input: unknown = {}, userId = U) =>
  runAsUser(db, userId, async (tx) =>
    runTool({ tx, crypto: await loadUserCrypto(tx, provider, userId), today }, name, input),
  );

describe("Ask tools", () => {
  it("sums spending by category with refunds netted out, only for the asking user", async () => {
    const { result } = await tool("spending_summary", {
      start_date: "2026-08-01",
      end_date: "2026-08-31",
      group_by: "category",
    });
    expect(result).toMatchObject({
      total_spent: 42.5 + 18 + 120.4 - 8,
      transactions: 4,
      groups: [
        { name: "Groceries", spent: 120.4, transactions: 1 },
        { name: "Restaurants & Dining", spent: 52.5, transactions: 3 },
      ],
    });
  });

  it("groups by merchant and month, and accepts a category by name", async () => {
    const { result: merchants } = await tool("spending_summary", {
      start_date: "2026-08-01",
      end_date: "2026-09-30",
      group_by: "merchant",
      category: "Restaurants & Dining",
    });
    expect(merchants).toMatchObject({
      total_spent: 82.5,
      groups: [
        { name: "Sushi Place", spent: 72.5, transactions: 2 },
        { name: "Taco Stand", spent: 10, transactions: 2 },
      ],
    });
    const { result: months } = await tool("spending_summary", {
      start_date: "2026-08-01",
      end_date: "2026-09-30",
      group_by: "month",
      category: "dining",
    });
    expect(months).toMatchObject({
      groups: [
        { name: "2026-08", spent: 52.5 },
        { name: "2026-09", spent: 30 },
      ],
    });
  });

  it("finds transactions by text, newest first, with direction", async () => {
    const { result } = await tool("find_transactions", {
      search: "taco",
      start_date: "2026-01-01",
      end_date: "2026-09-30",
    });
    expect(result).toMatchObject({
      matching: 2,
      money_out_total: 18,
      money_in_total: 8,
      transactions: [
        { date: "2026-08-21", merchant: "Taco Stand", amount: 8, direction: "money in" },
        { date: "2026-08-20", merchant: "Taco Stand", amount: 18, direction: "money out" },
      ],
    });
  });

  it("reports income, spending and net per month", async () => {
    const { result } = await tool("income_and_net", { start_month: "2026-08", end_month: "2026-09" });
    expect(result).toMatchObject({
      months: [
        { month: "2026-08", income: 0, spending: 172.9, net: -172.9 },
        { month: "2026-09", income: 0, spending: 45.49, net: -45.49 },
      ],
      totals: { spending: 218.39 },
    });
  });

  it("rejects bad input in a way the model can correct", async () => {
    await expect(tool("spending_summary", { start_date: "Aug 1", end_date: "2026-08-31" })).rejects.toBeInstanceOf(
      ToolInputError,
    );
    await expect(
      tool("spending_summary", { start_date: "2026-08-01", end_date: "2026-08-31", category: "yachts" }),
    ).rejects.toThrow(/Unknown category/);
    await expect(tool("drop_tables")).rejects.toBeInstanceOf(ToolInputError);
  });

  it("describes every tool with a JSON schema object", () => {
    for (const spec of toolSpecs()) {
      expect(spec.input_schema.type).toBe("object");
      expect(spec.input_schema).not.toHaveProperty("$schema");
    }
  });
});

/** A stand-in for the Messages API that replays scripted responses and records requests. */
function scriptedClient(responses: Array<Partial<Anthropic.Message>>) {
  const create = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no more scripted responses");
    return next as Anthropic.Message;
  });
  return { client: { messages: { create } } as unknown as Pick<Anthropic, "messages">, create };
}

const deps = (client: Pick<Anthropic, "messages">) => ({ client, run: runner(db), provider });

describe("askQuestion", () => {
  it("runs the tools the model asks for as the asking user and returns its answer", async () => {
    const { client, create } = scriptedClient([
      {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "spending_summary",
            input: { start_date: "2026-08-01", end_date: "2026-08-31", group_by: "none", category: "dining" },
          } as Anthropic.ToolUseBlock,
        ],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "You spent $52.50 on dining in August." } as Anthropic.TextBlock],
      },
    ]);
    const answer = await askQuestion(deps(client), U, "How much did I spend on dining in August?");
    expect(answer).toEqual({
      answer: "You spent $52.50 on dining in August.",
      steps: ["Spending on dining, Aug 1 – Aug 31, 2026"],
    });

    // The tool result sent back holds U's total (not V's $9,999 bill).
    const second = (create.mock.calls[1] as unknown as [Anthropic.MessageCreateParams])[0];
    const toolResult = (second.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0];
    expect(JSON.parse(toolResult.content as string)).toMatchObject({ total_spent: 52.5 });
    expect(JSON.stringify(second.messages)).not.toContain("9999");
    expect(second.system).toContain(OFF_TOPIC_REPLY);
  });

  it("sends tool input errors back to the model instead of failing", async () => {
    const { client, create } = scriptedClient([
      {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "spending_summary",
            input: { start_date: "yesterday" },
          } as Anthropic.ToolUseBlock,
        ],
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Which dates?" } as Anthropic.TextBlock] },
    ]);
    expect((await askQuestion(deps(client), U, "spend?")).answer).toBe("Which dates?");
    const second = (create.mock.calls[1] as unknown as [Anthropic.MessageCreateParams])[0];
    expect((second.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0].is_error).toBe(true);
  });

  it("stops calling tools after a few rounds and asks for a final answer", async () => {
    const loop = {
      stop_reason: "tool_use" as const,
      content: [{ type: "tool_use", id: "t", name: "budgets", input: {} } as Anthropic.ToolUseBlock],
    };
    const { client, create } = scriptedClient([
      ...Array.from({ length: 5 }, () => ({ ...loop })),
      { stop_reason: "end_turn", content: [{ type: "text", text: "Done." } as Anthropic.TextBlock] },
    ]);
    expect((await askQuestion(deps(client), U, "budgets?")).answer).toBe("Done.");
    expect(create).toHaveBeenCalledTimes(6);
    const lastCall = (create.mock.calls[5] as unknown as [Anthropic.MessageCreateParams])[0];
    expect(lastCall.tool_choice).toEqual({ type: "none" });
  });
});
