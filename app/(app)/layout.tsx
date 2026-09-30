import { UserButton } from "@clerk/nextjs";
import { AppShell } from "@/components/shell/app-shell";
import { TimezoneSync } from "@/components/shell/timezone-sync";
import { requireUserId } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { loadTimezone } from "@/lib/user";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Pages under (app) must still call requireUser() themselves: layouts don't
  // re-run on client-side navigation, so this check alone isn't enough.
  const userId = await requireUserId();
  const timezone = await withUser(userId, (tx) => loadTimezone(tx, userId));
  return (
    <AppShell user={<UserButton />}>
      <TimezoneSync stored={timezone} />
      {children}
    </AppShell>
  );
}
