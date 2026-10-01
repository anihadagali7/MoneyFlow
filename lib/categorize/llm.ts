import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { SYSTEM_PROMPT } from "./prompt";
import { CATEGORY_SLUGS, type CategorySlug } from "./taxonomy";

/** What we send per transaction. Nothing else about the user leaves the server. */
export type LlmTransaction = {
  i: number;
  acct: "card" | "bank";
  merchant: string | null;
  desc: string;
  amount: number;
  date: string;
  plaid: string | null;
};

export type FewShot = { merchant: string; category: CategorySlug };

export type LlmResult = {
  i: number;
  category: CategorySlug;
  confidence: number;
  is_subscription: boolean;
  travel_hint: string | null;
};

export type Categorizer = (items: LlmTransaction[], fewShots: FewShot[]) => Promise<LlmResult[]>;

const ResultSchema = z.object({
  results: z.array(
    z.object({
      i: z.number().int(),
      category: z.enum(CATEGORY_SLUGS),
      confidence: z.number(),
      is_subscription: z.boolean(),
      travel_hint: z.string().nullable(),
    }),
  ),
});

export const CATEGORIZATION_MODEL = "claude-haiku-4-5";

export function renderUserMessage(items: LlmTransaction[], fewShots: FewShot[]): string {
  const parts: string[] = [];
  if (fewShots.length) {
    parts.push(
      "This user's own categorizations (follow these for matching merchants):\n" +
        fewShots.map((f) => `- ${f.merchant} → ${f.category}`).join("\n"),
    );
  }
  parts.push(`Transactions:\n${JSON.stringify(items)}`);
  return parts.join("\n\n");
}

// Fail a slow call rather than run out the 60s function limit; the next run picks up the rest.
export function createClaudeCategorizer(client = new Anthropic({ timeout: 40_000, maxRetries: 1 })): Categorizer {
  return async (items, fewShots) => {
    const response = await client.messages.parse({
      model: CATEGORIZATION_MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: renderUserMessage(items, fewShots) }],
      output_config: { format: zodOutputFormat(ResultSchema) },
    });
    if (!response.parsed_output) {
      throw new Error(`Categorization returned no parseable output (stop_reason: ${response.stop_reason})`);
    }
    return response.parsed_output.results.map((r) => ({
      ...r,
      confidence: Math.min(1, Math.max(0, r.confidence)),
    }));
  };
}
