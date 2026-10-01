"use server";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { askQuestion as ask, type AskAnswer } from "@/lib/ask";
import { requireUser } from "@/lib/auth";
import { getKeyProvider } from "@/lib/crypto/keyProvider";
import { withUser } from "@/lib/db";
import { allow } from "@/lib/guard";

const AskInput = z.object({
  question: z.string().trim().min(2, "Ask a question").max(500, "Keep questions under 500 characters"),
  // Earlier turns of this conversation, kept in the browser (never stored on the server).
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) }))
    .max(12)
    .default([]),
});

export type AskResult = ({ ok: true } & AskAnswer) | { ok: false; error: string };

export async function askQuestion(input: z.input<typeof AskInput>): Promise<AskResult> {
  const userId = await requireUser();
  const parsed = AskInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ask a question" };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "Ask isn't set up on this server yet." };
  if (!(await allow(userId, "ask"))) {
    return { ok: false, error: "You've asked a lot today. Ask again tomorrow." };
  }
  try {
    const answer = await ask(
      {
        client: new Anthropic({ timeout: 30_000, maxRetries: 1 }),
        run: (id, fn) => withUser(id, fn),
        provider: getKeyProvider(),
      },
      userId,
      parsed.data.question,
      parsed.data.history,
    );
    return { ok: true, ...answer };
  } catch (err) {
    // Never log the question or data, only that it failed.
    console.error(JSON.stringify({ level: "error", msg: "ask failed", error: (err as Error).name }));
    return { ok: false, error: "Something went wrong answering that. Please try again." };
  }
}
