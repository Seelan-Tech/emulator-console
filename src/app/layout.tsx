import "./globals.css";

import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import { Providers } from "@/components/providers";
import { docsUrl } from "@/lib/docs-url";
import { readEnv } from "@/lib/env";

export const metadata: Metadata = {
  title: { default: "Emulator Console", template: "%s · Emulator Console" },
  description: "Saved targets, replayable fixtures and an activity log for your local AWS emulator.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <Providers>
          <div className="flex min-h-screen flex-col">
            <AppHeader docsUrl={docsUrl(process.env.NEXT_PUBLIC_APP_VERSION, readEnv().DOCS_URL)} />
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
