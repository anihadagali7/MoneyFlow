import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { ThemeProvider } from "@/components/shell/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "MoneyFlow", template: "%s · MoneyFlow" },
  description: "Private, AI-categorized credit card expense tracking",
  // "Add to Home Screen" on iPhone opens MoneyFlow full screen, like an app.
  appleWebApp: { capable: true, title: "MoneyFlow", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Draw under the notch and home indicator; layout pads with safe-area insets instead.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0f" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Per-request CSP nonce set in proxy.ts; inline scripts (theme) must carry it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // `dynamic` makes Clerk read the nonce and attach it to its own script.
    <ClerkProvider dynamic>
      <html
        lang="en"
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="min-h-full">
          <ThemeProvider nonce={nonce}>
            <TooltipProvider>
              {children}
              <Toaster position="top-center" mobileOffset={{ top: "calc(env(safe-area-inset-top) + 12px)" }} />
            </TooltipProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
