import { clerkMiddleware } from "@clerk/nextjs/server";

// Attaches the Clerk session to each request. Auth is enforced where data is accessed
// (requireUser() in lib/auth.ts, called by every protected page, Server Action and
// Route Handler), not by path matching here.
//
// Content-Security-Policy: Clerk generates a per-request nonce and 'strict-dynamic', so
// only scripts Next.js/Clerk render with the nonce (and scripts they load) can run.
// Next.js reads the nonce from this header and applies it to its own scripts.
export const proxy = clerkMiddleware({
  contentSecurityPolicy: {
    strict: true,
    directives: {
      // Plaid Link runs in an iframe from cdn.plaid.com, loaded by link-initialize.js.
      "script-src": ["https://cdn.plaid.com"],
      "frame-src": ["https://cdn.plaid.com"],
      "connect-src": ["https://*.plaid.com"],
      "img-src": ["data:", "blob:"],
      "object-src": ["none"],
      "base-uri": ["self"],
      "frame-ancestors": ["none"],
    },
  },
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
