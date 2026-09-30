"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the page's server data every few seconds while mounted, for work finishing in the background. */
export function AutoRefresh({ everyMs = 5000, maxMs = 180_000 }: { everyMs?: number; maxMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started > maxMs || document.hidden) return;
      router.refresh();
    }, everyMs);
    return () => clearInterval(id);
  }, [router, everyMs, maxMs]);
  return null;
}
