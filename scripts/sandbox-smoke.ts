/**
 * Checks your Plaid Sandbox and Anthropic keys end to end, without touching the database:
 * creates a Sandbox Item, pulls its transactions, and asks Claude to categorize a sample.
 *
 *   npm run smoke
 */
import { loadEnvConfig } from "@next/env";
import { Configuration, PlaidApi, PlaidEnvironments, Products } from "plaid";
import { createClaudeCategorizer } from "../lib/categorize/llm";
import { fetchAllUpdates } from "../lib/plaid/sync";

loadEnvConfig(process.cwd());

async function main() {
  if (process.env.PLAID_ENV && process.env.PLAID_ENV !== "sandbox") {
    throw new Error("This script only runs against PLAID_ENV=sandbox");
  }
  const plaid = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments.sandbox,
      baseOptions: {
        headers: { "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID, "PLAID-SECRET": process.env.PLAID_SECRET },
      },
    }),
  );

  console.log("1. Creating a Sandbox Item (First Platypus Bank, user_transactions_dynamic)…");
  const { data: pub } = await plaid.sandboxPublicTokenCreate({
    institution_id: "ins_109508",
    initial_products: [Products.Transactions],
    options: { override_username: "user_transactions_dynamic", override_password: "pass_good" },
  });
  const { data: exchange } = await plaid.itemPublicTokenExchange({ public_token: pub.public_token });
  const accessToken = exchange.access_token;

  try {
    console.log("2. Waiting for Plaid to prepare transactions…");
    let updates = await fetchAllUpdates(async (token, cursor) => (await plaid.transactionsSync({ access_token: token, cursor, count: 500 })).data, accessToken, undefined);
    for (let i = 0; i < 10 && updates.added.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      updates = await fetchAllUpdates(async (token, cursor) => (await plaid.transactionsSync({ access_token: token, cursor, count: 500 })).data, accessToken, undefined);
    }
    const credit = new Set(updates.accounts.filter((a) => a.type === "credit").map((a) => a.account_id));
    const cardTxns = updates.added.filter((t) => credit.has(t.account_id));
    console.log(`   ${updates.added.length} transactions (${cardTxns.length} on credit cards) across ${updates.accounts.length} accounts`);

    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("3. Skipping categorization: ANTHROPIC_API_KEY is not set");
      return;
    }
    const sample = (cardTxns.length ? cardTxns : updates.added).slice(0, 15);
    console.log(`3. Categorizing ${sample.length} transactions with Claude…`);
    const results = await createClaudeCategorizer()(
      sample.map((t, i) => ({
        i,
        acct: credit.has(t.account_id) ? ("card" as const) : ("bank" as const),
        merchant: t.merchant_name ?? null,
        desc: t.name,
        amount: t.amount,
        date: t.date,
        plaid: t.personal_finance_category?.detailed ?? null,
      })),
      [],
    );
    for (const r of results) {
      const t = sample[r.i];
      console.log(`   ${(t.merchant_name ?? t.name).padEnd(28).slice(0, 28)} ${String(t.amount).padStart(9)}  →  ${r.category} (${r.confidence.toFixed(2)})`);
    }
  } finally {
    await plaid.itemRemove({ access_token: accessToken });
    console.log("Done. Removed the Sandbox Item.");
  }
}

main().catch((err) => {
  console.error(err?.response?.data ?? err);
  process.exit(1);
});
