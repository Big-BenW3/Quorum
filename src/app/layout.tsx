import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Quorum: run an election your members can trust", template: "%s · Quorum" },
  description: "Set up a ballot, import your voter list, and run an election with turnout tracking and clear results. Built for clubs, unions, associations and student bodies.",
  robots: { index: true, follow: true },
};
export const viewport: Viewport = { themeColor: [{ media: "(prefers-color-scheme: light)", color: "#fafafa" }, { media: "(prefers-color-scheme: dark)", color: "#09090b" }] };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("theme")?.value;
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}${theme === "dark" ? " dark" : ""}`} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow">Skip to content</a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
