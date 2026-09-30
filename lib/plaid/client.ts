import "server-only";
import { Configuration, PlaidApi, PlaidEnvironments, type TransactionsSyncRequest } from "plaid";
import type { FetchSyncPage } from "./sync";

let client: PlaidApi | undefined;

export function getPlaid(): PlaidApi {
  if (client) return client;
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = process.env.PLAID_ENV ?? "sandbox";
  if (!clientId || !secret) throw new Error("PLAID_CLIENT_ID and PLAID_SECRET must be set");
  const basePath = PlaidEnvironments[env];
  if (!basePath) throw new Error(`Unknown PLAID_ENV: ${env}`);
  client = new PlaidApi(
    new Configuration({
      basePath,
      baseOptions: { headers: { "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret, "Plaid-Version": "2020-09-14" } },
    }),
  );
  return client;
}

export const fetchSyncPage: FetchSyncPage = async (accessToken, cursor) => {
  const request: TransactionsSyncRequest = {
    access_token: accessToken,
    count: 500,
    options: { include_personal_finance_category: true },
  };
  if (cursor) request.cursor = cursor;
  const { data } = await getPlaid().transactionsSync(request);
  return data;
};
