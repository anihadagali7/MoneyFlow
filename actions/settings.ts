"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { isValidTimeZone } from "@/lib/time";

/** Saves the device's timezone so "today" and month boundaries match the user's clock. */
export async function updateTimezone(timezone: string): Promise<{ ok: boolean }> {
  const userId = await requireUser();
  if (!isValidTimeZone(timezone)) return { ok: false };
  await withUser(userId, (tx) => tx.update(users).set({ timezone }).where(eq(users.id, userId)));
  revalidatePath("/", "layout");
  return { ok: true };
}
