import Link from "next/link";
import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import { Button, buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-4 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">MoneyFlow</h1>
      <p className="max-w-md text-muted-foreground">
        See where your money goes. Connect your credit cards, get every transaction
        categorized automatically, and track your net spend each month.
      </p>
      <div className="flex gap-3">
        <Show when="signed-out">
          <SignInButton>
            <Button>Sign in</Button>
          </SignInButton>
          <SignUpButton>
            <Button variant="outline">Create account</Button>
          </SignUpButton>
        </Show>
        <Show when="signed-in">
          <Link href="/dashboard" className={buttonVariants()}>
            Go to dashboard
          </Link>
        </Show>
      </div>
    </main>
  );
}
