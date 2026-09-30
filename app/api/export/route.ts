import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { buildExport, transactionsCsv } from "@/lib/export";
import { allow } from "@/lib/guard";
import { loadUserContext } from "@/lib/user";

export const maxDuration = 60;

/** Downloads your data: ?format=csv (transactions) or ?format=json (everything). */
export async function GET(req: Request) {
  const userId = await requireUser();
  if (!(await allow(userId, "export"))) return new Response("Too many exports. Try again in an hour.", { status: 429 });
  const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "json";

  const { data, today } = await withUser(userId, async (tx) => {
    const { crypto, today } = await loadUserContext(tx, userId);
    const data = await buildExport(tx, crypto);
    await tx.insert(auditLog).values({ userId, action: "export", meta: { format } });
    return { data, today };
  });

  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (format === "csv") {
    return new Response(transactionsCsv(data), {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="moneyflow-transactions-${today.iso}.csv"`,
      },
    });
  }
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="moneyflow-export-${today.iso}.json"`,
    },
  });
}
