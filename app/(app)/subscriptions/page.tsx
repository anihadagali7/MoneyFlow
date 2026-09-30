import type { Metadata } from "next";
import { SubscriptionsView } from "@/components/views/subscriptions-view";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { loadSubscriptions, recentMerchants, refreshSubscriptions } from "@/lib/subscriptions";
import { loadUserContext } from "@/lib/user";

export const metadata: Metadata = { title: "Subscriptions" };

export default async function SubscriptionsPage() {
  const userId = await requireUser();
  const { data, merchants, today } = await withUser(userId, async (tx) => {
    const { crypto, today } = await loadUserContext(tx, userId);
    // Detection is cheap (blind-index grouping), so run it fresh on each visit.
    await refreshSubscriptions(tx, crypto, today);
    const [data, merchants] = await Promise.all([
      loadSubscriptions(tx, crypto, today),
      recentMerchants(tx, crypto, today),
    ]);
    return { data, merchants, today };
  });
  return <SubscriptionsView data={data} merchants={merchants} today={today.iso} />;
}
