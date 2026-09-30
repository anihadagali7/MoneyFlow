"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowLeftRightIcon,
  ChartColumnIcon,
  CreditCardIcon,
  LayoutDashboardIcon,
  PiggyBankIcon,
  RepeatIcon,
  SettingsIcon,
  WalletIcon,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";

export const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboardIcon, mobile: true },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRightIcon, mobile: true },
  { href: "/budgets", label: "Budgets", icon: PiggyBankIcon, mobile: true },
  { href: "/subscriptions", label: "Subscriptions", icon: RepeatIcon, mobile: false },
  { href: "/reports", label: "Reports", icon: ChartColumnIcon, mobile: true },
  { href: "/income", label: "Income", icon: WalletIcon, mobile: true },
  // On phones, Cards lives under Settings to keep the tab bar to five.
  { href: "/accounts", label: "Cards", icon: CreditCardIcon, mobile: false },
] as const;

function SettingsLink({ active }: { active: boolean }) {
  return (
    <Link
      href="/settings"
      aria-label="Settings"
      aria-current={active ? "page" : undefined}
      className={cn(buttonVariants({ variant: "ghost", size: "icon" }), active && "bg-muted")}
    >
      <SettingsIcon />
    </Link>
  );
}

/**
 * Signed-in layout: a sidebar on desktop, a top bar plus bottom tab bar on phones.
 * `user` is the account menu (Clerk's UserButton in the app).
 */
export function AppShell({ children, user, activeHref }: { children: ReactNode; user?: ReactNode; activeHref?: string }) {
  const pathname = usePathname();
  const active = activeHref ?? pathname;
  const isActive = (href: string) => active === href || active.startsWith(`${href}/`);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-sidebar px-3 py-5 md:flex">
        <Link href="/dashboard" className="px-2">
          <Logo />
        </Link>
        <nav className="mt-8 flex flex-col gap-0.5" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                isActive(href) && "bg-muted font-medium text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between gap-2 border-t px-1 pt-4">
          {user}
          <div className="flex items-center">
            <SettingsLink active={isActive("/settings")} />
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-[var(--header-h)] items-end justify-between border-b bg-background/85 px-4 pt-[env(safe-area-inset-top)] pb-2.5 backdrop-blur-lg md:hidden">
          <Link href="/dashboard">
            <Logo />
          </Link>
          <div className="flex items-center gap-0.5">
            <ThemeToggle />
            <SettingsLink active={isActive("/settings")} />
            <span className="ml-1.5 flex">{user}</span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-[max(1rem,env(safe-area-inset-left))] pt-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-8 md:pt-10 md:pb-12">
          {children}
        </main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-background/90 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden"
      >
        {NAV.filter((n) => n.mobile).map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn(
              "group flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground active:opacity-60",
              isActive(href) && "font-medium text-foreground",
            )}
          >
            <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", isActive(href) && "bg-muted")}>
              <Icon className="size-5" />
            </span>
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
