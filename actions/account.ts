"use server";

import { clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deleteUserData, disconnectItem as disconnect } from "@/lib/account";
import { forgetProvisionedUser, requireUser } from "@/lib/auth";

export async function disconnectItem(itemId: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const userId = await requireUser();
  const name = await disconnect(userId, z.uuid().parse(itemId));
  if (!name) return { ok: false, error: "That card connection wasn't found." };
  revalidatePath("/", "layout");
  return { ok: true, name };
}

/** Deletes all MoneyFlow data and the login. The user must type DELETE to confirm. */
export async function deleteAccount(confirmation: string): Promise<{ ok: false; error: string } | { ok: true }> {
  const userId = await requireUser();
  if (confirmation.trim() !== "DELETE") return { ok: false, error: 'Type DELETE to confirm.' };
  await deleteUserData(userId, "app");
  forgetProvisionedUser(userId);
  // Deleting the Clerk user also ends the session.
  const clerk = await clerkClient();
  await clerk.users.deleteUser(userId);
  return { ok: true };
}
