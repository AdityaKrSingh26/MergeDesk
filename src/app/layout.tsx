import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { HEADER_TAGLINE, ONE_LINER, PRODUCT_NAME } from "@/server/shared";
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
  title: PRODUCT_NAME,
  description: ONE_LINER,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <header className="border-b border-[var(--desk-rule)] bg-[var(--desk-paper)]">
          <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
            <Link href="/" className="text-base font-semibold tracking-tight">
              {PRODUCT_NAME}
            </Link>
            <span aria-hidden="true" className="text-[var(--desk-brass)]">
              —
            </span>
            <span className="text-sm text-[var(--desk-muted)]">{HEADER_TAGLINE}</span>
            <span aria-hidden="true" className="text-[var(--desk-brass)]">
              —
            </span>
            <span className="text-sm font-medium tracking-wide">Token Factory</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
