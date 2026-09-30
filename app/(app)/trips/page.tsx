import type { Metadata } from "next";
import { TripsView } from "@/components/views/trips-view";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { loadTrips } from "@/lib/trips";
import { loadUserContext } from "@/lib/user";

export const metadata: Metadata = { title: "Trips" };

export default async function TripsPage() {
  const userId = await requireUser();
  const { data, today } = await withUser(userId, async (tx) => {
    const { crypto, today } = await loadUserContext(tx, userId);
    return { data: await loadTrips(tx, crypto, today), today };
  });
  return <TripsView data={data} today={today.iso} />;
}
