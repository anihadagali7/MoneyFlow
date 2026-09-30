import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { after } from "next/server";
import { findItemOwner, markWebhookProcessed, recordWebhookEvent, withUser } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema";
import { refreshUser } from "@/lib/jobs";
import { getPlaid } from "@/lib/plaid/client";
import { verifyPlaidWebhook } from "@/lib/plaid/webhook";

export const maxDuration = 60;

type PlaidWebhook = {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  error?: { error_code?: string } | null;
};

const STATUS_BY_CODE: Record<string, string> = {
  PENDING_EXPIRATION: "pending_expiration",
  PENDING_DISCONNECT: "pending_expiration",
  USER_PERMISSION_REVOKED: "revoked",
  USER_ACCOUNT_REVOKED: "revoked",
};

export async function POST(req: Request) {
  const rawBody = await req.text();
  const verified = await verifyPlaidWebhook(rawBody, req.headers.get("plaid-verification"), async (keyId) => {
    const { data } = await getPlaid().webhookVerificationKeyGet({ key_id: keyId });
    return data.key as never;
  });
  if (!verified) return new Response("Invalid signature", { status: 401 });

  const body = JSON.parse(rawBody) as PlaidWebhook;
  const eventId = await recordWebhookEvent({
    source: "plaid",
    bodySha256: createHash("sha256").update(rawBody).digest(),
    plaidItemId: body.item_id,
    webhookType: body.webhook_type,
    webhookCode: body.webhook_code,
  });
  if (!eventId) return new Response(null, { status: 200 }); // duplicate delivery
  const done = () => markWebhookProcessed(eventId);
  if (!body.item_id) {
    await done();
    return new Response(null, { status: 200 });
  }

  const userId = await findItemOwner(body.item_id);
  if (!userId) {
    await done();
    return new Response(null, { status: 200 });
  }
  const plaidItemId = body.item_id;

  const code = body.webhook_code ?? "";
  if (body.webhook_type === "TRANSACTIONS" && ["SYNC_UPDATES_AVAILABLE", "DEFAULT_UPDATE", "INITIAL_UPDATE", "HISTORICAL_UPDATE"].includes(code)) {
    after(async () => {
      const [item] = await withUser(userId, (tx) =>
        tx.select({ id: plaidItems.id }).from(plaidItems).where(eq(plaidItems.plaidItemId, plaidItemId)),
      );
      if (item) await refreshUser(userId, { itemIds: [item.id] });
      await done();
    });
  } else if (body.webhook_type === "ITEM") {
    const errorCode = body.error?.error_code;
    const status =
      code === "ERROR" && errorCode === "ITEM_LOGIN_REQUIRED" ? "login_required" : code === "ERROR" ? "error" : STATUS_BY_CODE[code];
    if (status) {
      await withUser(userId, (tx) =>
        tx
          .update(plaidItems)
          .set({ status, lastErrorCode: errorCode ?? code })
          .where(eq(plaidItems.plaidItemId, plaidItemId)),
      );
    }
    await done();
  } else {
    await done();
  }

  return new Response(null, { status: 200 });
}
