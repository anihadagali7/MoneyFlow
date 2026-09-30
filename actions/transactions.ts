"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { setTransactionCategory } from "@/lib/categorize/rules";
import { withUser } from "@/lib/db";
import { allow } from "@/lib/guard";
import { RateLimitError } from "@/lib/rate-limit";

const Input = z.object({
  transactionId: z.uuid(),
  categoryId: z.uuid(),
  applyToMerchant: z.boolean(),
});

export async function setCategory(input: z.infer<typeof Input>) {
  const userId = await requireUser();
  if (!(await allow(userId, "category.set"))) throw new RateLimitError();
  const { transactionId, categoryId, applyToMerchant } = Input.parse(input);
  const result = await withUser(userId, (tx) =>
    setTransactionCategory(tx, userId, transactionId, categoryId, applyToMerchant),
  );
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  return result;
}
