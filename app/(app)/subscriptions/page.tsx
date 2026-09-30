import type { Metadata } from "next";
import { SubscriptionsView } from "@/components/views/subscriptions-view";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { loadSubscriptions, refreshSubscriptions } from "@/lib/subscriptions";
import { loadUserContext } from "@/lib/user";

export const metadata: Metadata = { title: "Subscriptions" };

export default async function SubscriptionsPage() {
  const userId = await requireUser();
  const { data, today } = await withUser(userId, async (tx) => {
    const { crypto, today } = await loadUserContext(tx, userId);
    // Detection is cheap (blind-index grouping), so run it fresh on each visit.
    await refreshSubscriptions(tx, crypto, today);
    return { data: await loadSubscriptions(tx, crypto, today), today };
  });
  return <SubscriptionsView data={data} today={today.iso} />;
}
