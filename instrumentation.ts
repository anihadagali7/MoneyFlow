import type { Instrumentation } from "next";

/** Runs once per server instance, before it takes requests. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnv } = await import("./lib/env");
  const { missing, warnings } = checkEnv();
  if (missing.length > 0) console.error(JSON.stringify({ level: "error", msg: "missing configuration", missing }));
  for (const warning of warnings) console.warn(JSON.stringify({ level: "warn", msg: warning }));
}

/**
 * One structured line per server error, keyed by the same digest users see on the error
 * screen and in feedback reports, so a report can be matched to its log. No query strings.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const digest = typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : undefined;
  console.error(
    JSON.stringify({
      level: "error",
      msg: "request failed",
      digest,
      method: request.method,
      path: request.path.split("?")[0],
      route: context.routePath,
      routeType: context.routeType,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    }),
  );
};
