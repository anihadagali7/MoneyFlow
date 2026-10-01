import "server-only";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { withUser } from "@/lib/db";
import { getKeyProvider } from "@/lib/crypto/keyProvider";
import { ensureUserRow } from "@/lib/crypto/userKeys";

/** Returns the signed-in user's id, or redirects to sign-in. */
export async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return userId;
}

const provisioned = new Set<string>();

/**
 * Returns the signed-in user's id, creating their row and encryption keys on first
 * visit. Doing this lazily means local development works without a Clerk webhook.
 */
export async function requireUser(): Promise<string> {
  const userId = await requireUserId();
  if (provisioned.has(userId)) return userId;

  await withUser(userId, (tx) => ensureUserRow(tx, getKeyProvider(), userId));
  provisioned.add(userId);
  return userId;
}

export function forgetProvisionedUser(userId: string) {
  provisioned.delete(userId);
}
