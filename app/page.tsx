import Link from "next/link";
import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import { ChartColumnIcon, LockIcon, SparklesIcon, WalletIcon } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";

const FEATURES = [
  {
    icon: SparklesIcon,
    title: "Categorized for you",
    body: "Every transaction is labeled automatically: groceries, subscriptions, flights. Fix one and MoneyFlow remembers.",
  },
  {
    icon: WalletIcon,
    title: "Income and net, every month",
    body: "Add your paycheck once. See what came in, what went out, and what you kept.",
  },
  {
    icon: ChartColumnIcon,
    title: "Reports that answer questions",
    body: "Spending by category, card and merchant over the last 3, 6 or 12 months.",
  },
  {
    icon: LockIcon,
    title: "Private by design",
    body: "Connect through Plaid, so your bank password never touches MoneyFlow. Your data is encrypted with your own key.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 md:px-8">
        <Logo />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Show when="signed-out">
            <SignInButton>
              <Button variant="ghost">Sign in</Button>
            </SignInButton>
          </Show>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 md:px-8">
        <section className="flex flex-col items-center py-16 text-center md:py-24">
          <span className="mb-5 inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            <LockIcon className="size-3" /> Bank-level connections through Plaid
          </span>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance md:text-6xl">
            See where your money flows.
          </h1>
          <p className="mt-5 max-w-xl text-base text-pretty text-muted-foreground md:text-lg">
            Connect your credit cards, get every purchase categorized automatically, and know your net for every month.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Show when="signed-out">
              <SignUpButton>
                <Button size="lg" className="h-10 px-5">
                  Get started
                </Button>
              </SignUpButton>
              <SignInButton>
                <Button size="lg" variant="outline" className="h-10 px-5">
                  Sign in
                </Button>
              </SignInButton>
            </Show>
            <Show when="signed-in">
              <Link href="/dashboard" className={buttonVariants({ size: "lg", className: "h-10 px-5" })}>
                Go to your overview
              </Link>
            </Show>
          </div>
        </section>

        <section className="grid gap-4 pb-20 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border bg-card p-5">
              <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
                <Icon className="size-4" />
              </span>
              <h2 className="mt-4 font-medium">{title}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">MoneyFlow · Personal expense tracking</footer>
    </div>
  );
}
