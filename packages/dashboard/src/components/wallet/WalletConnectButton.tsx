"use client";

import { useState, useRef, useEffect } from "react";
import { useWallet } from "./WalletContext";
import {
  truncateHash,
  displayAccountHash,
  formatCspr,
} from "@/lib/format";

/**
 * DESIGN.md §6.2 — Wallet connect button with connected dropdown.
 */
export function WalletConnectButton() {
  const { state, connect, disconnect } = useWallet();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleConnect = async () => {
    try {
      if (state.status === "disconnected" || state.status === "error") {
        await connect();
      } else if (state.status === "connected") {
        setDropdownOpen((o) => !o);
      }
    } catch {
      // WalletProvider sets error state; this guards against unexpected throws.
    }
  };

  // Close dropdown on outside click.
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  // Close dropdown on Escape.
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDropdownOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [dropdownOpen]);

  const isConnected = state.status === "connected";
  const isConnecting = state.status === "connecting";
  const hasError = state.status === "error";

  const accountHashRaw =
    isConnected
      ? displayAccountHash(state.accountHash)
      : "";
  const shortHash = isConnected ? truncateHash(accountHashRaw) : "";
  const balance = isConnected ? formatCspr(state.balanceMotes) : "";

  const ariaLabel = isConnected
    ? `Wallet connected: ${shortHash}. Click to manage.`
    : hasError
    ? "Connection failed. Click to retry."
    : "Connect Casper Wallet";

  const borderColor = hasError
    ? "var(--color-danger)"
    : isConnected
    ? "var(--color-border-default)"
    : "var(--color-accent-gold-dim)";

  const textColor = hasError
    ? "var(--color-danger)"
    : isConnected
    ? "var(--color-text-secondary)"
    : "var(--color-accent-gold)";

  const bgColor = isConnected
    ? "var(--color-bg-raised)"
    : "var(--color-accent-gold-20)";

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: "var(--space-1)",
        }}
      >
      <button
        ref={buttonRef}
        type="button"
        onClick={handleConnect}
        disabled={isConnecting}
        aria-label={ariaLabel}
        aria-expanded={isConnected ? dropdownOpen : undefined}
        aria-haspopup={isConnected ? "menu" : undefined}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-2)",
          minHeight: "44px",
          padding: "0 var(--space-4)",
          borderRadius: "var(--radius-full)",
          border: `1px solid ${borderColor}`,
          background: bgColor,
          color: textColor,
          fontFamily: "var(--font-body)",
          fontSize: "var(--text-sm)",
          fontWeight: "var(--weight-medium)",
          cursor: isConnecting ? "not-allowed" : "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {isConnecting ? (
          <>
            <SpinnerIcon />
            <span>Connecting…</span>
          </>
        ) : isConnected ? (
          <>
            <span className="live-dot" aria-hidden="true" />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
              {shortHash}
            </span>
            <span style={{ color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>
              {balance}
            </span>
          </>
        ) : hasError ? (
          <span>Connection Failed — Retry</span>
        ) : (
          <span>Connect Wallet</span>
        )}
      </button>

      {hasError && state.status === "error" && (
        <p
          role="alert"
          style={{
            margin: 0,
            maxWidth: "280px",
            fontSize: "var(--text-2xs)",
            color: "var(--color-danger)",
            textAlign: "right",
            lineHeight: 1.3,
          }}
        >
          {state.message}
        </p>
      )}
      </div>

      {isConnected && dropdownOpen && (
        <div
          ref={dropdownRef}
          role="menu"
          aria-label="Wallet actions"
          style={{
            position: "absolute",
            top: "calc(100% + var(--space-2))",
            right: 0,
            minWidth: "280px",
            background: "var(--color-bg-overlay)",
            border: "1px solid var(--color-border-default)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-lg)",
            zIndex: 200,
            overflow: "hidden",
          }}
        >
          {/* Full account hash */}
          <div
            style={{
              padding: "var(--space-4)",
              borderBottom: "1px solid var(--color-border-subtle)",
            }}
          >
            <div style={{ fontSize: "var(--text-2xs)", color: "var(--color-text-muted)", marginBottom: "var(--space-1)", fontWeight: "var(--weight-semibold)", letterSpacing: "var(--tracking-widest)", textTransform: "uppercase" }}>
              Account
            </div>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-2xs)",
                color: "var(--color-text-secondary)",
                wordBreak: "break-all",
                userSelect: "text",
              }}
            >
              {accountHashRaw}
            </span>
          </div>

          {/* Balance */}
          <div
            style={{
              padding: "var(--space-4)",
              borderBottom: "1px solid var(--color-border-subtle)",
            }}
          >
            <div style={{ fontSize: "var(--text-2xs)", color: "var(--color-text-muted)", marginBottom: "var(--space-1)", fontWeight: "var(--weight-semibold)", letterSpacing: "var(--tracking-widest)", textTransform: "uppercase" }}>
              Balance
            </div>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xl)",
                color: "var(--color-text-primary)",
              }}
            >
              {balance}
            </span>
          </div>

          {/* Disconnect */}
          <button
            role="menuitem"
            type="button"
            onClick={async () => {
              setDropdownOpen(false);
              await disconnect();
            }}
            style={{
              display: "block",
              width: "100%",
              padding: "var(--space-4)",
              background: "none",
              border: "none",
              textAlign: "left",
              color: "var(--color-danger)",
              fontFamily: "var(--font-body)",
              fontSize: "var(--text-sm)",
              cursor: "pointer",
              minHeight: "44px",
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function SpinnerIcon() {
  return (
    <svg className="spinner" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="2" strokeDasharray="24" strokeDashoffset="8" strokeLinecap="round" />
    </svg>
  );
}
