import Link from "next/link";
import { after } from "next/server";
import { count, eq, isNull } from "drizzle-orm";
import { ConnectCardButton } from "@/components/plaid/connect-card-button";
import { SyncButton } from "@/components/sync-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { plaidItems, transactions } from "@/lib/db/schema";
import { refreshUser, shouldRefresh } from "@/lib/jobs";
import { formatCents } from "@/lib/money";
import { formatMonth, monthSpend, parseMonth } from "@/lib/reports/spend";

// Background sync and categorization run after the response, within this budget.
export const maxDuration = 60;

const STATUS_LABEL: Record<string, string> = {
  active: "Connected",
  login_required: "Reconnect needed",
  pending_expiration: "Expiring soon",
  revoked: "Disconnected",
  error: "Sync error",
};

export default async function DashboardPage() {
  const userId = await requireUser();
  const month = parseMonth(undefined);

  const { items, spend, review, uncategorized } = await withUser(userId, async (tx) => {
    const [items, spend, [review], [uncategorized]] = await Promise.all([
      tx.select().from(plaidItems).orderBy(plaidItems.createdAt),
      monthSpend(tx, month),
      tx.select({ n: count() }).from(transactions).where(eq(transactions.needsReview, true)),
      tx.select({ n: count() }).from(transactions).where(isNull(transactions.categoryId)),
    ]);
    return { items, spend, review: review.n, uncategorized: uncategorized.n };
  });

  // Webhooks keep things fresh in production; this covers local dev and missed webhooks.
  if (shouldRefresh(items, uncategorized)) after(() => refreshUser(userId));

  if (items.length === 0) {
    return (
      <Card className="mx-auto mt-12 max-w-md text-center">
        <CardHeader>
          <CardTitle>Connect your first card</CardTitle>
          <CardDescription>
            You&apos;ll log in to your bank through Plaid. MoneyFlow never sees your bank password.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <ConnectCardButton />
        </CardContent>
      </Card>
    );
  }

  const maxCategory = Math.max(1, ...spend.byCategory.map((c) => c.cents));
  const monthLabel = new Date(month.year, month.month - 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Spent in {monthLabel}</CardDescription>
            <CardTitle className="text-3xl">{formatCents(spend.totalCents)}</CardTitle>
          </CardHeader>
          {spend.uncategorized.n > 0 && (
            <CardContent className="text-sm text-muted-foreground">
              + {spend.uncategorized.n} transaction{spend.uncategorized.n === 1 ? "" : "s"} still being categorized
            </CardContent>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Needs review</CardDescription>
            <CardTitle className="text-3xl">{review}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {review > 0 ? (
              <Link href="/transactions?review=1" className="underline underline-offset-4">
                Check low-confidence labels
              </Link>
            ) : (
              <span className="text-muted-foreground">All labels look confident</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Categorizing</CardDescription>
            <CardTitle className="text-3xl">{uncategorized}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {uncategorized > 0 ? "AI is labeling these. Refresh in a minute." : "Everything is labeled"}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Spending by category</CardTitle>
          <CardDescription>{monthLabel}, posted transactions</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {spend.byCategory.length === 0 && <p className="text-sm text-muted-foreground">No categorized spending yet.</p>}
          {spend.byCategory.map((c) => (
            <Link
              key={c.slug}
              href={`/transactions?month=${formatMonth(month)}&category=${c.slug}`}
              className="group flex flex-col gap-1"
            >
              <div className="flex justify-between text-sm">
                <span className="group-hover:underline">{c.name}</span>
                <span className="tabular-nums">{formatCents(c.cents)}</span>
              </div>
              <div className="h-2 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${Math.max(2, (Math.max(0, c.cents) / maxCategory) * 100)}%` }}
                />
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Connected cards</CardTitle>
            <CardDescription>Through Plaid</CardDescription>
          </div>
          <div className="flex gap-2">
            <SyncButton />
            <ConnectCardButton label="Add card" variant="outline" />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <div className="font-medium">{item.institutionName ?? "Card"}</div>
                <div className="text-sm text-muted-foreground">
                  {item.lastSyncedAt ? `Synced ${item.lastSyncedAt.toLocaleString("en-US")}` : "Importing…"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={item.status === "active" ? "secondary" : "destructive"}>
                  {STATUS_LABEL[item.status] ?? item.status}
                </Badge>
                {(item.status === "login_required" || item.status === "pending_expiration") && (
                  <ConnectCardButton itemId={item.id} label="Reconnect" variant="outline" />
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
