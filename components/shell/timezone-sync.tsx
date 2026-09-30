"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { updateTimezone } from "@/actions/settings";

/** Keeps the stored timezone in sync with the device (e.g. after traveling). Renders nothing. */
export function TimezoneSync({ stored }: { stored: string }) {
  const router = useRouter();
  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && detected !== stored) {
      updateTimezone(detected).then((r) => r.ok && router.refresh());
    }
  }, [stored, router]);
  return null;
}
