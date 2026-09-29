import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Db } from "./core";
import * as schema from "./schema";

// Import `withUser` from "@/lib/db" instead. This raw handle is restricted by ESLint
// to lib/db so every query goes through a user-scoped transaction.

const globalForDb = globalThis as unknown as { db?: Db };

export function getDb(): Db {
  if (globalForDb.db) return globalForDb.db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const db: Db = drizzle(new Pool({ connectionString, max: 10 }), { schema });
  // Cache on globalThis so dev hot reloads reuse one pool.
  globalForDb.db = db;
  return db;
}
