"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangleIcon } from "lucide-react";
import { recordError } from "@/components/feedback/error-log";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const pathname = usePathname();
  useEffect(() => {
    console.error(error);
    recordError(error, error.digest);
  }, [error]);

  const report = new URLSearchParams({ kind: "bug", from: pathname });
  if (error.digest) report.set("digest", error.digest);

  return (
    <Card className="mx-auto mt-6 flex max-w-md flex-col items-center gap-3 p-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangleIcon className="size-5" />
      </span>
      <div className="text-lg font-semibold">Something went wrong</div>
      <p className="text-sm text-muted-foreground">
        This page hit an error. Trying again often fixes it. If it doesn&apos;t, a quick report helps us fix it.
      </p>
      {error.digest && <p className="text-xs text-muted-foreground">Error id: {error.digest}</p>}
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <Link href={`/feedback?${report.toString()}`} className={buttonVariants({ variant: "outline" })}>
          Report this problem
        </Link>
      </div>
    </Card>
  );
}
