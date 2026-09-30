import type { Metadata } from "next";
import { asc, desc } from "drizzle-orm";
import { listCustomCategories } from "@/lib/categories";
import { SettingsView } from "@/components/views/settings-view";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { auditLog, categories } from "@/lib/db/schema";
import { loadTimezone } from "@/lib/user";
import { nowMs } from "@/lib/views/dates";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const userId = await requireUser();
  const data = await withUser(userId, async (tx) => {
    const [timezone, activity, customCategories, categoryOptions] = await Promise.all([
      loadTimezone(tx, userId),
      tx
        .select({ id: auditLog.id, action: auditLog.action, createdAt: auditLog.createdAt })
        .from(auditLog)
        .orderBy(desc(auditLog.createdAt))
        .limit(15),
      listCustomCategories(tx),
      tx.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name)),
    ]);
    return {
      timezone,
      customCategories,
      categoryOptions,
      activity: activity.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    };
  });
  return <SettingsView data={data} now={nowMs()} />;
}
