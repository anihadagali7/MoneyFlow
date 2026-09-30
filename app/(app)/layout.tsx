import { UserButton } from "@clerk/nextjs";
import { AppShell } from "@/components/shell/app-shell";
import { requireUserId } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Pages under (app) must still call requireUser() themselves: layouts don't
  // re-run on client-side navigation, so this check alone isn't enough.
  await requireUserId();
  return <AppShell user={<UserButton />}>{children}</AppShell>;
}
