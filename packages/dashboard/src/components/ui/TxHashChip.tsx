"use client";

import { useState } from "react";
import { truncateHash, explorerUrl } from "@/lib/format";

interface TxHashChipProps {
  hash: string;
  showCopy?: boolean;
}

/**
 * Transaction hash chip — DESIGN.md §6.10.
 *
 * Accessibility:
 * - Full hash in aria-label.
 * - "opens in new tab" visually-hidden text.
 * - rel="noopener noreferrer" on external link.
 */
export function TxHashChip({ hash, showCopy = true }: TxHashChipProps) {
  const [copied, setCopied] = useState(false);

  if (!hash) return null;

  const short = truncateHash(hash);
  const url = explorerUrl(hash);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
      }}
    >
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={hash}
        aria-label={`View transaction ${hash} on cspr.live testnet explorer (opens in new tab)`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-1)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-2xs)",
          color: "var(--color-accent-gold)",
          textDecoration: "none",
        }}
      >
        <ExternalIcon />
        <span>{short}</span>
        <span className="sr-only"> (opens in new tab)</span>
      </a>
      {showCopy && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy payment receipt hash"
          title={copied ? "Copied!" : "Copy receipt hash"}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "var(--space-1)",
            color: copied
              ? "var(--color-positive)"
              : "var(--color-text-muted)",
            minWidth: "44px",
            minHeight: "44px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      )}
    </span>
  );
}

function ExternalIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path
        d="M5.5 1H9V4.5M9 1L4.5 5.5M1 2h3v7H1V2z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 8H2a1 1 0 01-1-1V2a1 1 0 011-1h5a1 1 0 011 1v1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 6.5l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
