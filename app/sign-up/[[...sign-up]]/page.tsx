import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { Logo } from "@/components/shell/logo";

export default function SignUpPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-4">
      <Link href="/">
        <Logo className="text-lg" />
      </Link>
      <SignUp />
    </main>
  );
}
