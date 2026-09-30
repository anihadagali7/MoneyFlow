import { eq } from "drizzle-orm";
import { getKeyProvider } from "@/lib/crypto/keyProvider";
import { loadUserCrypto, type UserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import { users } from "@/lib/db/schema";
import { DEFAULT_TIMEZONE, todayIn, type Today } from "@/lib/time";

export async function loadTimezone(tx: Tx, userId: string): Promise<string> {
  const [row] = await tx.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
  return row?.timezone ?? DEFAULT_TIMEZONE;
}

/** What most pages need: the user's field encryption and "today" in their timezone. */
export async function loadUserContext(tx: Tx, userId: string): Promise<{ crypto: UserCrypto; today: Today; timezone: string }> {
  const [crypto, timezone] = await Promise.all([loadUserCrypto(tx, getKeyProvider(), userId), loadTimezone(tx, userId)]);
  return { crypto, timezone, today: todayIn(timezone) };
}
