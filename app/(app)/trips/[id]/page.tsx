import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { TripDetailView } from "@/components/views/trip-detail-view";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { loadTripDetail } from "@/lib/trips";
import { loadUserContext } from "@/lib/user";

export const metadata: Metadata = { title: "Trip" };

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const result = await withUser(userId, async (tx) => {
    const { crypto, today } = await loadUserContext(tx, userId);
    return { data: await loadTripDetail(tx, crypto, id), today };
  });
  if (!result.data) notFound();
  return <TripDetailView data={result.data} today={result.today.iso} />;
}
