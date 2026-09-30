import type { Metadata } from "next";
import { AccountsView } from "@/components/views/accounts-view";
import { requireUser } from "@/lib/auth";
import { getKeyProvider } from "@/lib/crypto/keyProvider";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { withUser } from "@/lib/db";
import { loadItems } from "@/lib/views/data";
import { nowMs } from "@/lib/views/dates";

export const metadata: Metadata = { title: "Cards" };
export const maxDuration = 60;

export default async function AccountsPage() {
  const userId = await requireUser();
  const items = await withUser(userId, async (tx) => loadItems(tx, await loadUserCrypto(tx, getKeyProvider(), userId)));
  return <AccountsView items={items} now={nowMs()} />;
}
