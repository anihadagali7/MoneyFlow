import "server-only";
import { withUser } from "@/lib/db";
import { takeRateLimit, type RateLimitedAction } from "@/lib/rate-limit";

/** Returns false if the user has hit the limit for this action. */
export function allow(userId: string, action: RateLimitedAction): Promise<boolean> {
  return withUser(userId, (tx) => takeRateLimit(tx, userId, action));
}
