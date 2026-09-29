import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { requireUserId } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Pages under (app) must still call requireUser() themselves: layouts don't
  // re-run on client-side navigation, so this check alone isn't enough.
  await requireUserId();
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <Link href="/dashboard" className="font-semibold">
          MoneyFlow
        </Link>
        <UserButton />
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-4">{children}</main>
    </div>
  );
}
