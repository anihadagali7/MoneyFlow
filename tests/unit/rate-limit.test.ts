import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAsUser, type Db } from "@/lib/db/core";
import { rateLimits } from "@/lib/db/schema";
import { LIMITS, takeRateLimit } from "@/lib/rate-limit";
import { seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

const U = "user_rl";
let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await seedUserWithItem(db, U);
});
afterEach(() => close());

const take = (now: number) => runAsUser(db, U, (tx) => takeRateLimit(tx, U, "export", now));

describe("takeRateLimit", () => {
  it("allows up to the limit in a window, then blocks until the next window", async () => {
    const t0 = Date.UTC(2026, 8, 30, 10, 0, 0);
    const { limit, windowSeconds } = LIMITS.export;
    for (let i = 0; i < limit; i++) expect(await take(t0 + i)).toBe(true);
    expect(await take(t0 + limit)).toBe(false);
    expect(await take(t0 + windowSeconds * 1000)).toBe(true);
  });

  it("cleans up old windows", async () => {
    const t0 = Date.UTC(2026, 8, 30, 10, 0, 0);
    await take(t0);
    await take(t0 + 2 * 3600_000);
    const rows = await runAsUser(db, U, (tx) => tx.select().from(rateLimits));
    expect(rows).toHaveLength(1);
  });
});
