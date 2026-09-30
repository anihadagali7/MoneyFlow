import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { SettingsView } from "@/components/views/settings-view";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { loadTimezone } from "@/lib/user";
import { nowMs } from "@/lib/views/dates";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const userId = await requireUser();
  const data = await withUser(userId, async (tx) => {
    const [timezone, activity] = await Promise.all([
      loadTimezone(tx, userId),
      tx
        .select({ id: auditLog.id, action: auditLog.action, createdAt: auditLog.createdAt })
        .from(auditLog)
        .orderBy(desc(auditLog.createdAt))
        .limit(15),
    ]);
    return { timezone, activity: activity.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })) };
  });
  return <SettingsView data={data} now={nowMs()} />;
}
