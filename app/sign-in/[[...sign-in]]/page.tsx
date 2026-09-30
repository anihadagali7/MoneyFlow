import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { Logo } from "@/components/shell/logo";

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-4">
      <Link href="/">
        <Logo className="text-lg" />
      </Link>
      <SignIn />
    </main>
  );
}
