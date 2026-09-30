import { AlertTriangleIcon, CheckCircle2Icon, CreditCardIcon, LockIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ConnectCardButton } from "@/components/plaid/connect-card-button";
import { DisconnectButton } from "@/components/settings/disconnect-button";
import { SyncButton } from "@/components/sync-button";
import { Card } from "@/components/ui/card";
import { relativeTime } from "@/lib/views/dates";
import type { ItemSummary } from "@/lib/views/data";

const STATUS: Record<string, { label: string; ok: boolean }> = {
  active: { label: "Connected", ok: true },
  login_required: { label: "Reconnect needed", ok: false },
  pending_expiration: { label: "Access expiring soon", ok: false },
  revoked: { label: "Disconnected at your bank", ok: false },
  error: { label: "Sync error", ok: false },
};

export function AccountsView({ items, now }: { items: ItemSummary[]; now: number }) {
  return (
    <>
      <PageHeader
        title="Cards"
        description="Banks connected through Plaid"
        actions={
          items.length > 0 ? (
            <>
              <SyncButton />
              <ConnectCardButton label="Add a bank" />
            </>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <Card>
          <EmptyState icon={CreditCardIcon} title="No cards connected" description="Connect a bank to import your credit card transactions." action={<ConnectCardButton />} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((item) => {
            const status = STATUS[item.status] ?? { label: item.status, ok: false };
            return (
              <Card key={item.id} className="gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
                      <CreditCardIcon className="size-5 text-muted-foreground" />
                    </span>
                    <div>
                      <div className="font-medium">{item.institutionName}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.lastSyncedAt ? `Synced ${relativeTime(item.lastSyncedAt, now)}` : "Importing…"}
                      </div>
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 text-xs ${status.ok ? "text-positive" : "text-destructive"}`}>
                    {status.ok ? <CheckCircle2Icon className="size-3.5" /> : <AlertTriangleIcon className="size-3.5" />}
                    {status.label}
                  </span>
                </div>
                {item.cards.length > 0 && (
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {item.cards.map((c) => (
                      <li key={c} className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2">
                        <span className="truncate">{c}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {!status.ok && item.status !== "revoked" ? (
                    <ConnectCardButton itemId={item.id} label="Reconnect" variant="outline" />
                  ) : (
                    <span />
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
        MoneyFlow never sees your bank password. Access tokens and card names are stored encrypted.
      </p>
    </>
  );
}
