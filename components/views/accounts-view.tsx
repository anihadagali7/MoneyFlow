import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CreditCardIcon,
  FileCheckIcon,
  Loader2Icon,
  LockIcon,
} from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ConnectCardButton } from "@/components/plaid/connect-card-button";
import { CardMenu, RestoreCardButton } from "@/components/settings/card-controls";
import { DisconnectButton } from "@/components/settings/disconnect-button";
import { SyncButton } from "@/components/sync-button";
import { Card } from "@/components/ui/card";
import { relativeTime } from "@/lib/views/dates";
import { formatCents } from "@/lib/money";
import type { AccountSummary, ItemSummary } from "@/lib/views/data";

const STATUS: Record<string, { label: string; ok: boolean }> = {
  active: { label: "Connected", ok: true },
  login_required: { label: "Reconnect needed", ok: false },
  pending_expiration: { label: "Access expiring soon", ok: false },
  revoked: { label: "Disconnected at your bank", ok: false },
  error: { label: "Sync error", ok: false },
};

const TYPE_LABEL: Record<string, string> = { credit: "Credit card", depository: "Bank account" };

function accountKind(c: AccountSummary) {
  if (c.type === "depository") return c.subtype === "savings" ? "Savings" : "Checking";
  return TYPE_LABEL[c.type] ?? c.type;
}

export function AccountsView({ items, now }: { items: ItemSummary[]; now: number }) {
  const cash = items
    .flatMap((i) => i.cards)
    .filter((c) => !c.removed && c.type === "depository" && c.balanceCents !== null)
    .reduce((a, c) => a + c.balanceCents!, 0);
  const hasBank = items.some((i) => i.cards.some((c) => c.type === "depository" && !c.removed));
  const categorizing = items.some((i) => i.cards.some((c) => (c.imported?.categorizing ?? 0) > 0));
  return (
    <>
      {categorizing && <AutoRefresh />}
      <PageHeader
        title="Accounts"
        description={
          hasBank ? `${formatCents(cash)} in checking and savings` : "Cards and bank accounts connected through Plaid"
        }
        actions={
          items.length > 0 ? (
            <>
              <SyncButton />
              <ConnectCardButton label="Connect" />
            </>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={CreditCardIcon}
            title="Nothing connected yet"
            description="Connect a credit card or bank account to import its transactions."
            action={<ConnectCardButton />}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((item) => {
            const status = STATUS[item.status] ?? { label: item.status, ok: false };
            return (
              <Card key={item.id} className="gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <CreditCardIcon className="size-5 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{item.institutionName}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.lastSyncedAt ? `Synced ${relativeTime(item.lastSyncedAt, now)}` : "Importing…"}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 text-xs ${status.ok ? "text-positive" : "text-destructive"}`}
                  >
                    {status.ok ? <CheckCircle2Icon className="size-3.5" /> : <AlertTriangleIcon className="size-3.5" />}
                    {status.label}
                  </span>
                </div>
                {item.cards.some((c) => !c.removed) && (
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {item.cards
                      .filter((c) => !c.removed)
                      .map((c) => (
                        <li
                          key={c.id}
                          className="flex items-center justify-between gap-2 rounded-md bg-muted/60 py-1.5 pr-1 pl-3"
                        >
                          <span className="min-w-0">
                            <span className="block truncate">{c.label}</span>
                            <span className="block text-xs text-muted-foreground">{accountKind(c)}</span>
                            {c.imported && <ImportedLine imported={c.imported} />}
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            {c.balanceCents !== null && (
                              <span className="tabular text-right text-sm">
                                {formatCents(c.balanceCents)}
                                {c.type === "credit" && (
                                  <span className="block text-[11px] text-muted-foreground">owed</span>
                                )}
                              </span>
                            )}
                            <CardMenu id={c.id} label={c.label} bank={item.institutionName} />
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
                {item.cards.some((c) => c.removed) && (
                  <div className="flex flex-col gap-1 text-sm">
                    <div className="text-xs text-muted-foreground">Removed</div>
                    {item.cards
                      .filter((c) => c.removed)
                      .map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between gap-2 py-0.5 pl-3 text-muted-foreground"
                        >
                          <span className="truncate line-through decoration-muted-foreground/50">{c.label}</span>
                          <RestoreCardButton id={c.id} label={c.label} />
                        </div>
                      ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {!status.ok && item.status !== "revoked" ? (
                    <ConnectCardButton itemId={item.id} label="Reconnect" variant="outline" />
                  ) : (
                    <ConnectCardButton itemId={item.id} mode="add_accounts" label="Add accounts" variant="ghost" />
                  )}
                  <DisconnectButton itemId={item.id} name={item.institutionName} />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        <LockIcon className="size-3.5" />
        MoneyFlow never sees your bank password. Access tokens, account names and balances are stored encrypted. Adding
        accounts from a bank you&apos;ve already connected doesn&apos;t use another Plaid connection.
      </p>
    </>
  );
}

/** "Jan – Jun 2025", or "Nov 2024 – Feb 2025" across years. */
function monthSpan(from: string, to: string) {
  const fmt = (d: string, year: boolean) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      year: year ? "numeric" : undefined,
      timeZone: "UTC",
    });
  return `${fmt(from, from.slice(0, 4) !== to.slice(0, 4))} – ${fmt(to, true)}`;
}

/** "312 imported · Jan – Jun 2025", with a note while categories are still being filled in. */
function ImportedLine({ imported }: { imported: NonNullable<AccountSummary["imported"]> }) {
  return (
    <span className="block text-xs text-muted-foreground">
      <FileCheckIcon className="mr-1 inline size-3 align-[-2px]" />
      {imported.count} imported · {monthSpan(imported.from, imported.to)}
      {imported.categorizing > 0 && (
        <span className="block">
          <Loader2Icon className="mr-1 inline size-3 animate-spin align-[-2px]" />
          Categorizing {imported.categorizing}…
        </span>
      )}
    </span>
  );
}
