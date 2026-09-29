import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Every query must go through withUser() so Row-Level Security applies (PLAN.md §3).
    files: ["**/*.{ts,tsx}"],
    ignores: ["lib/db/**", "tests/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/db/client", "**/db/client", "@/lib/db/core", "**/db/core"],
              message: "Use withUser() from '@/lib/db' so queries are scoped to one user.",
              allowTypeImports: true,
            },
            {
              group: ["pg", "drizzle-orm/node-postgres"],
              message: "Only lib/db may open database connections.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
