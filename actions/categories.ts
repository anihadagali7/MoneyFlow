"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { CategoryError, createCategory, deleteCategory, updateCategory } from "@/lib/categories";
import { withUser } from "@/lib/db";
import { allow } from "@/lib/guard";
import { RateLimitError } from "@/lib/rate-limit";

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const Input = z.object({
  name: z.string().trim().min(1, "Give the category a name").max(40, "Keep it under 40 characters"),
  countsAsSpend: z.boolean(),
});

async function run<T>(fn: (userId: string) => Promise<T>): Promise<Result<T>> {
  const userId = await requireUser();
  if (!(await allow(userId, "category.edit"))) return { ok: false, error: new RateLimitError().message };
  try {
    const data = await fn(userId);
    // Category names appear on nearly every page.
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (err) {
    if (err instanceof CategoryError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function createCategoryAction(input: z.input<typeof Input>): Promise<Result<{ id: string; name: string }>> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the name" };
  return run((userId) => withUser(userId, (tx) => createCategory(tx, userId, parsed.data)));
}

export async function updateCategoryAction(id: string, input: z.input<typeof Input>): Promise<Result<void>> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the name" };
  return run((userId) => withUser(userId, (tx) => updateCategory(tx, z.uuid().parse(id), parsed.data)));
}

export async function deleteCategoryAction(id: string, replacementId: string): Promise<Result<void>> {
  return run((userId) => withUser(userId, (tx) => deleteCategory(tx, userId, z.uuid().parse(id), z.uuid().parse(replacementId))));
}
