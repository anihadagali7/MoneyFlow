import { clerkMiddleware } from "@clerk/nextjs/server";

// Attaches the Clerk session to each request. Auth is enforced where data is accessed
// (requireUser() in lib/auth.ts, called by every protected page, Server Action and
// Route Handler), not by path matching here.
export const proxy = clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
