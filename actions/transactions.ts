"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { setTransactionCategory } from "@/lib/categorize/rules";
import { withUser } from "@/lib/db";

const Input = z.object({
  transactionId: z.uuid(),
  categoryId: z.uuid(),
  applyToMerchant: z.boolean(),
});

export async function setCategory(input: z.infer<typeof Input>) {
  const userId = await requireUser();
  const { transactionId, categoryId, applyToMerchant } = Input.parse(input);
  const result = await withUser(userId, (tx) =>
    setTransactionCategory(tx, userId, transactionId, categoryId, applyToMerchant),
  );
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  return result;
}
