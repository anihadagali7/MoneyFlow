import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/lib/db/core";
import * as schema from "@/lib/db/schema";

/**
 * In-memory Postgres with the real migrations applied. PGlite connects as a superuser,
 * and superusers always bypass RLS, so we switch to an ordinary role that owns the tables:
 * the situation the app must be in. (Neon's default `neondb_owner` is NOT like this: it
 * has BYPASSRLS, which is why production connects as a separate role.) `client.exec("reset
 * role")` goes back to the superuser to reproduce a role that bypasses RLS.
 */
export async function createTestDb() {
  const client = new PGlite();
  await client.exec(`
    create role app_owner nologin;
    grant all on schema public to app_owner;
    grant create on database postgres to app_owner;
    set role app_owner;
  `);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return { db: db as unknown as Db, client, close: () => client.close() };
}
