"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { acknowledgePriceIncrease, dismissSubscription } from "@/lib/subscriptions";

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
