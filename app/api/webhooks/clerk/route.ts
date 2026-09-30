import type { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { deleteUserData } from "@/lib/account";
import { forgetProvisionedUser } from "@/lib/auth";

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
    // Covers accounts deleted from Clerk's dashboard; a no-op if the app already did it.
    await deleteUserData(evt.data.id, "clerk");
    forgetProvisionedUser(evt.data.id);
  }

  return new Response(null, { status: 204 });
}
