"use server";

import { clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { deleteUserData, disconnectItem as disconnect } from "@/lib/account";
import { forgetProvisionedUser, requireUser } from "@/lib/auth";
import { removeCard, restoreCard } from "@/lib/cards";
import { withUser } from "@/lib/db";
import { refreshUser } from "@/lib/jobs";

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

export async function removeCardAction(accountId: string): Promise<{ ok: boolean; othersRemain: boolean }> {
  const userId = await requireUser();
  const result = await withUser(userId, (tx) => removeCard(tx, userId, z.uuid().parse(accountId)));
  revalidatePath("/", "layout");
  return { ok: result.found, othersRemain: result.othersRemain };
}

/** Adds a removed card back and re-imports its history in the background. */
export async function restoreCardAction(accountId: string): Promise<{ ok: boolean }> {
  const userId = await requireUser();
  const itemId = await withUser(userId, (tx) => restoreCard(tx, userId, z.uuid().parse(accountId)));
  if (!itemId) return { ok: false };
  after(() => refreshUser(userId, { itemIds: [itemId] }));
  revalidatePath("/", "layout");
  return { ok: true };
}
