"use client";

import { scrubTechnical, type FeedbackDetails } from "@/lib/feedback";

/** The last few errors in this tab, scrubbed, so a problem report can include them. */
const KEY = "mf:errors";
const MAX = 10;

type LoggedError = NonNullable<FeedbackDetails["errors"]>[number];

export function readErrors(): LoggedError[] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as LoggedError[];
  } catch {
    return [];
  }
}

export function recordError(error: unknown, digest?: string) {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const entry: LoggedError = {
    at: new Date().toISOString().slice(11, 19),
    message: scrubTechnical(raw).slice(0, 500),
    ...(digest ? { digest } : {}),
  };
  try {
    const errors = [...readErrors(), entry].slice(-MAX);
    sessionStorage.setItem(KEY, JSON.stringify(errors));
  } catch {
    // Storage can be unavailable (private mode); reports just won't include history.
  }
}

/** What a report can attach about this device and page. */
export function collectDetails(path: string): FeedbackDetails {
  return {
    path,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    standalone: window.matchMedia("(display-mode: standalone)").matches,
    errors: readErrors(),
  };
}
