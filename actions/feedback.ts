"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { buildIssue, FEEDBACK_AREAS, FEEDBACK_KINDS, type FeedbackArea, type FeedbackKind } from "@/lib/feedback";
import { createIssue, FeedbackNotConfiguredError } from "@/lib/feedback/github";
import { allow } from "@/lib/guard";
import { RateLimitError } from "@/lib/rate-limit";

const text = (max: number) => z.string().trim().max(max);
const FeedbackSchema = z.object({
  kind: z.enum(Object.keys(FEEDBACK_KINDS) as [FeedbackKind, ...FeedbackKind[]]),
  area: z.enum(Object.keys(FEEDBACK_AREAS) as [FeedbackArea, ...FeedbackArea[]]),
  title: text(120).min(3, "Add a short summary"),
  description: text(4000),
  details: z
    .object({
      path: text(300).optional(),
      userAgent: text(400).optional(),
      viewport: text(40).optional(),
      standalone: z.boolean().optional(),
      errors: z
        .array(z.object({ at: text(40), message: text(1000), digest: text(40).optional() }))
        .max(10)
        .optional(),
    })
    .nullish(),
});

export type FeedbackResult = { ok: true; issue: number } | { ok: false; error: string };

/**
 * Files feedback as a GitHub issue. The issue identifies the sender only by a short hash of
 * their user id ("reporter"), which the owner can recompute from the Clerk dashboard.
 */
export async function submitFeedback(input: z.input<typeof FeedbackSchema>): Promise<FeedbackResult> {
  const userId = await requireUser();
  if (!(await allow(userId, "feedback"))) return { ok: false, error: new RateLimitError().message };
  const parsed = FeedbackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };

  const issue = buildIssue(parsed.data, {
    reporter: reporterRef(userId),
    appVersion: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
    sentAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
  });
  try {
    const number = await createIssue(issue);
    await withUser(userId, (tx) =>
      tx.insert(auditLog).values({ userId, action: "feedback", meta: { kind: parsed.data.kind, issue: number } }),
    );
    return { ok: true, issue: number };
  } catch (err) {
    if (err instanceof FeedbackNotConfiguredError) return { ok: false, error: err.message };
    console.error("feedback failed", { error: (err as Error).message });
    return { ok: false, error: "Couldn't send that just now. Please try again in a minute." };
  }
}

/** sha256("moneyflow-feedback:" + Clerk user id), first 10 hex characters. */
function reporterRef(userId: string) {
  return createHash("sha256").update(`moneyflow-feedback:${userId}`).digest("hex").slice(0, 10);
}
