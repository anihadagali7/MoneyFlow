import type { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { eq } from "drizzle-orm";
import { forgetProvisionedUser } from "@/lib/auth";
import { evictCachedKeys } from "@/lib/crypto/userKeys";
import { withUser } from "@/lib/db";
import { auditLog, users } from "@/lib/db/schema";

/**
 * Clerk → MoneyFlow. Signature-verified with CLERK_WEBHOOK_SIGNING_SECRET.
 * Users are created lazily on first sign-in (lib/auth.ts), so only deletion is handled here.
 */
export async function POST(req: NextRequest) {
  let evt;
  try {
    evt = await verifyWebhook(req);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  if (evt.type === "user.deleted" && evt.data.id) {
    const userId = evt.data.id;
    // Deleting the row removes the wrapped keys, which makes any ciphertext left in
    // backups unreadable (crypto-shredding). Child rows cascade.
    // TODO(phase 2): call Plaid /item/remove for each Item before deleting.
    await withUser(userId, async (tx) => {
      await tx.insert(auditLog).values({ userId, action: "account.delete", meta: { via: "clerk" } });
      await tx.delete(users).where(eq(users.id, userId));
    });
    evictCachedKeys(userId);
    forgetProvisionedUser(userId);
  }

  return new Response(null, { status: 204 });
}
