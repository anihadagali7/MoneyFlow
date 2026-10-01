import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureUserRow, getUserKeys } from "@/lib/crypto/userKeys";
import { rlsBypassReason, runAsUser, type Db } from "@/lib/db/core";
import { users } from "@/lib/db/schema";
import { provider } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

let db: Db;
let client: Awaited<ReturnType<typeof createTestDb>>["client"];
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, client, close } = await createTestDb());
});
afterEach(() => close());

describe("database role", () => {
  it("passes for an ordinary role, which RLS applies to", async () => {
    expect(await rlsBypassReason(db)).toBeNull();
  });

  it("names a superuser or BYPASSRLS role, like Neon's neondb_owner", async () => {
    await client.exec("reset role");
    expect(await rlsBypassReason(db)).toMatch(/is a superuser/);
    await client.exec("create role owner_like nologin bypassrls; set role owner_like;");
    expect(await rlsBypassReason(db)).toBe('database role "owner_like" has BYPASSRLS');
  });
});

describe("first visit", () => {
  it("creates the user's row once, with keys that load", async () => {
    await runAsUser(db, "user_a", (tx) => ensureUserRow(tx, provider, "user_a"));
    await runAsUser(db, "user_a", (tx) => ensureUserRow(tx, provider, "user_a"));
    const rows = await runAsUser(db, "user_a", (tx) => tx.select().from(users));
    expect(rows.map((r) => r.id)).toEqual(["user_a"]);
    await expect(runAsUser(db, "user_a", (tx) => getUserKeys(tx, provider, "user_a"))).resolves.toBeDefined();
  });

  it("still creates a new user's row when the role can see other users' rows", async () => {
    // What production did: as a role that bypasses RLS, "is there a users row?" found someone
    // else's, so the new user never got one and every page failed with "User keys not found".
    await runAsUser(db, "user_owner", (tx) => ensureUserRow(tx, provider, "user_owner"));
    await client.exec("reset role");
    await runAsUser(db, "user_friend", (tx) => ensureUserRow(tx, provider, "user_friend"));
    const [friend] = await runAsUser(db, "user_friend", (tx) =>
      tx.select({ id: users.id }).from(users).where(eq(users.id, "user_friend")),
    );
    expect(friend?.id).toBe("user_friend");
  });
});
