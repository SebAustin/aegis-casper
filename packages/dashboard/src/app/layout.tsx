import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import "@/styles/global.css";
import { Header } from "@/components/header/Header";
import { WalletProvider } from "@/components/wallet/WalletProvider";

export const metadata: Metadata = {
  title: "Aegis — Autonomous RWA Yield-Routing Agent",
  description:
    "Real-time cockpit for the Aegis autonomous vault. Monitor allocation, agent reputation, and live decisions.",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Read the nonce injected by middleware (NFR-S-05).
  const headersList = await headers();
  const nonce = headersList.get("x-nonce") ?? "";

  return (
    <html lang="en" className="dark">
      <head>
        {/* Preconnect hints for self-hosted fonts are handled by @fontsource */}
      </head>
      <body>
        <a href="#main-cockpit" className="skip-link">
          Skip to dashboard
        </a>
        <WalletProvider nonce={nonce}>
          <Header nonce={nonce} />
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}
