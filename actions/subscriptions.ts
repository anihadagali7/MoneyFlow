"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import {
  acknowledgePriceIncrease,
  dismissSubscription,
  markAsSubscription,
  SubscriptionError,
} from "@/lib/subscriptions";
import { FREQUENCIES } from "@/lib/subscriptions/detect";
import { loadUserContext } from "@/lib/user";

function refresh() {
  revalidatePath("/subscriptions");
  revalidatePath("/dashboard");
}

/** "Not a subscription": hides it, and detection won't bring it back. */
export async function hideSubscription(id: string) {
  const userId = await requireUser();
  await withUser(userId, (tx) => dismissSubscription(tx, z.uuid().parse(id)));
  refresh();
}

export async function dismissPriceIncrease(id: string) {
  const userId = await requireUser();
  await withUser(userId, (tx) => acknowledgePriceIncrease(tx, z.uuid().parse(id)));
  refresh();
}

/** Tracks a transaction's merchant as a subscription on the chosen schedule. */
export async function markSubscriptionAction(
  transactionId: string,
  frequency: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requireUser();
  const f = z
    .enum(Object.keys(FREQUENCIES) as [keyof typeof FREQUENCIES, ...Array<keyof typeof FREQUENCIES>])
    .parse(frequency);
  try {
    await withUser(userId, async (tx) => {
      const { crypto, today } = await loadUserContext(tx, userId);
      await markAsSubscription(tx, crypto, z.uuid().parse(transactionId), f, today);
    });
  } catch (err) {
    if (err instanceof SubscriptionError) return { ok: false, error: err.message };
    throw err;
  }
  refresh();
  return { ok: true };
}
