"use client";

import "./globals.css";

/** Last resort when the root layout itself fails; keeps to plain markup. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
        <main className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">MoneyFlow hit an error</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Try again. If it keeps happening, use Settings → Send feedback once the app loads, and include this id.
          </p>
          {error.digest && <p className="mt-2 text-xs text-muted-foreground">Error id: {error.digest}</p>}
          <button
            onClick={() => retry()}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
