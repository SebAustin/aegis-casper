"use client";

import Link from "next/link";
import { TriggerAgentRunButton } from "./TriggerAgentRunButton";
import { WalletConnectButton } from "../wallet/WalletConnectButton";
import { AegisLogo } from "./AegisLogo";

interface HeaderProps {
  nonce?: string;
}

/**
 * DESIGN.md §6.1 — sticky application header.
 * Height: 56px (--header-height).
 * bg: --color-bg-panel, border-bottom: 1px --color-border-subtle.
 */
export function Header({ nonce: _ }: HeaderProps) {
  return (
    <header
      role="banner"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        height: "var(--header-height)",
        background: "var(--color-bg-panel)",
        borderBottom: "1px solid var(--color-border-subtle)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 var(--space-8)",
      }}
    >
      <Link
        href="/"
        aria-label="Aegis home"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          textDecoration: "none",
          color: "var(--color-text-primary)",
        }}
      >
        <AegisLogo />
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-md)",
            fontWeight: "var(--weight-semibold)",
            letterSpacing: "var(--tracking-wide)",
          }}
        >
          AEGIS
        </span>
      </Link>

      <nav
        aria-label="Application controls"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
        }}
      >
        <TriggerAgentRunButton />
        <WalletConnectButton />
      </nav>
    </header>
  );
}
