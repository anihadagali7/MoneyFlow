import { count } from "drizzle-orm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { plaidItems, transactions } from "@/lib/db/schema";

export default async function DashboardPage() {
  const userId = await requireUser();
  const [items, txns] = await withUser(userId, (tx) =>
    Promise.all([
      tx.select({ n: count() }).from(plaidItems),
      tx.select({ n: count() }).from(transactions),
    ]),
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Connected cards</CardTitle>
          <CardDescription>Bank connections through Plaid</CardDescription>
        </CardHeader>
        <CardContent className="text-3xl font-semibold">{items[0].n}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
          <CardDescription>Synced and categorized</CardDescription>
        </CardHeader>
        <CardContent className="text-3xl font-semibold">{txns[0].n}</CardContent>
      </Card>
    </div>
  );
}
