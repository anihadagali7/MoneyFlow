import type { Metadata } from "next";
import { asc, desc } from "drizzle-orm";
import { listCustomCategories } from "@/lib/categories";
import { SettingsView } from "@/components/views/settings-view";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { auditLog, categories } from "@/lib/db/schema";
import { loadTimezone, loadUserContext } from "@/lib/user";
import { loadItems } from "@/lib/views/data";
import { shortDate } from "@/lib/views/dates";
import { nowMs } from "@/lib/views/dates";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const userId = await requireUser();
  const data = await withUser(userId, async (tx) => {
    const { crypto } = await loadUserContext(tx, userId);
    const [timezone, activity, customCategories, categoryOptions, items] = await Promise.all([
      loadTimezone(tx, userId),
      tx
        .select({ id: auditLog.id, action: auditLog.action, meta: auditLog.meta, createdAt: auditLog.createdAt })
        .from(auditLog)
        .orderBy(desc(auditLog.createdAt))
        .limit(15),
      listCustomCategories(tx),
      tx.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name)),
      loadItems(tx, crypto),
    ]);
    const cardLabel = new Map(items.flatMap((i) => i.cards.map((c) => [c.id, c.label])));
    return {
      timezone,
      customCategories,
      categoryOptions,
      activity: activity.map(({ meta, ...a }) => ({
        ...a,
        detail: a.action === "import" ? importDetail(meta, cardLabel) : null,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  });
  return <SettingsView data={data} now={nowMs()} />;
}

/** "142 into Freedom ••1234 · Jan 2, 2025 – Jun 29, 2025" */
function importDetail(meta: unknown, cardLabel: Map<string, string>) {
  const m = (meta ?? {}) as { rows?: number; accountId?: string; from?: string | null; to?: string | null };
  if (typeof m.rows !== "number") return null;
  const parts = [
    `${m.rows} transaction${m.rows === 1 ? "" : "s"}${m.accountId && cardLabel.has(m.accountId) ? ` into ${cardLabel.get(m.accountId)}` : ""}`,
  ];
  if (m.from && m.to)
    parts.push(`${shortDate(m.from)}, ${m.from.slice(0, 4)} – ${shortDate(m.to)}, ${m.to.slice(0, 4)}`);
  return parts.join(" · ");
}
