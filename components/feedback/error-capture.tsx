"use client";

import { useEffect } from "react";
import { recordError } from "./error-log";

/** Remembers uncaught errors in this tab for problem reports. Sends nothing by itself. */
export function ErrorCapture() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => recordError(e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => recordError(e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
