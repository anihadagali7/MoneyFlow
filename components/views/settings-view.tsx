import Link from "next/link";
import { ChevronRightIcon, CreditCardIcon, DownloadIcon, GlobeIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DeleteAccountButton } from "@/components/settings/delete-account";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { relativeTime } from "@/lib/views/dates";

export type SettingsData = {
  timezone: string;
  activity: Array<{ id: number; action: string; createdAt: string }>;
};

const ACTION_LABEL: Record<string, string> = {
  "item.link": "Connected a bank",
  "item.remove": "Disconnected a bank",
  "card.remove": "Removed a card",
  "card.restore": "Added a card back",
  "rule.create": "Created a category rule",
  export: "Downloaded your data",
  "account.delete": "Deleted account",
};

export function SettingsView({ data, now }: { data: SettingsData; now: number }) {
  return (
    <>
      <PageHeader title="Settings" description="Your data and account" />
      <div className="flex flex-col gap-4">
        <Link href="/accounts" className="md:hidden">
          <Card className="flex-row items-center gap-3 p-4">
            <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
              <CreditCardIcon className="size-4" />
            </span>
            <div className="flex-1">
              <div className="font-medium">Accounts</div>
              <div className="text-xs text-muted-foreground">Cards and bank accounts, balances, add or remove</div>
            </div>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </Card>
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Timezone</CardTitle>
            <CardDescription>Used for &ldquo;today&rdquo; and where each month starts and ends.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-start gap-2.5 text-sm">
            <GlobeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <div className="font-medium">{data.timezone.replace(/_/g, " ")}</div>
              <div className="text-xs text-muted-foreground">Set automatically from your device</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Download your data</CardTitle>
            <CardDescription>A copy of everything MoneyFlow stores about you, decrypted.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <a href="/api/export?format=csv" download className={buttonVariants({ variant: "outline" })}>
              <DownloadIcon /> Transactions (CSV)
            </a>
            <a href="/api/export?format=json" download className={buttonVariants({ variant: "outline" })}>
              <DownloadIcon /> Everything (JSON)
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Sensitive actions on your account</CardDescription>
          </CardHeader>
          <CardContent>
            {data.activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {data.activity.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span>{ACTION_LABEL[a.action] ?? a.action}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(a.createdAt, now)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>Delete account</CardTitle>
            <CardDescription>
              Permanently removes your data and login, and disconnects your banks at Plaid. Your encryption keys are
              destroyed, so even backups can&apos;t be read.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeleteAccountButton />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
