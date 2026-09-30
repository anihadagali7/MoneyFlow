/**
 * Applies pending migrations (drizzle/). Runs as the first step of Vercel's production
 * build (`npm run vercel-build`), so the schema is updated before new code goes live.
 * If a migration fails, the build fails and the previous deployment keeps serving.
 *
 * Needs MIGRATION_DATABASE_URL: the database's *direct* (unpooled) connection string,
 * set in Vercel for the Production environment only. Preview builds skip this step.
 * Migrations must stay backward compatible (additive), since the old code runs briefly
 * against the new schema while the deploy finishes.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== "production") {
    console.log(`[migrate] Skipping: ${vercelEnv} build (only production builds migrate).`);
    return;
  }
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    throw new Error(
      "[migrate] MIGRATION_DATABASE_URL is not set. Add the direct (unpooled) database URL in Vercel → " +
        "Settings → Environment Variables (Production). Stopping so code doesn't deploy without its schema.",
    );
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    console.log("[migrate] Database is up to date.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
