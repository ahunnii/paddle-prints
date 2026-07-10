import "~/styles/globals.css";

import { type Metadata, type Viewport } from "next";
import { Geist, Nunito } from "next/font/google";

import { TRPCReactProvider } from "~/trpc/react";
import { OfflineLayer } from "~/components/offline/offline-layer";
import { Toaster } from "~/components/ui/toaster";

export const metadata: Metadata = {
  title: "Paddle Prints",
  description: "Track and share your paddleboarding routes with your crew.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Paddle Prints",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f97316",
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

// Rounded, friendly display face for headings -- self-hosted at build time (no runtime request to
// Google, so it works offline once cached), body copy stays on the system font stack.
const nunito = Nunito({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
  variable: "--font-nunito",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${nunito.variable}`}>
      <body>
        <TRPCReactProvider>
          <OfflineLayer>
            {children}
            <Toaster />
          </OfflineLayer>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
