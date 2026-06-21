"use client";

import { useState } from "react";
import type { VaultState } from "@aegis/shared";
import type { PollStatus } from "@/hooks/usePoller";
import {
  formatCsprParts,
  formatShares,
  relativeTime,
  truncateHash,
  displayAccountHash,
} from "@/lib/format";
import { StatusChip } from "@/components/ui/StatusChip";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import { Button } from "@/components/ui/Button";
import { DepositWithdrawModal } from "./DepositWithdrawModal";

interface Props {
  data: VaultState | null;
  status: PollStatus;
  error: string | null;
  lastUpdatedMs: number | null;
  dataWarning?: string;
}

/**
 * DESIGN.md §6.3 — Vault Overview Panel.
 * FR-D-01, FR-D-05.
 */
export function VaultOverviewPanel({
  data,
  status,
  error,
  lastUpdatedMs,
  dataWarning,
}: Props) {
  const [modalMode, setModalMode] = useState<"deposit" | "withdraw" | null>(null);

  const isLoading = status === "idle" || status === "loading";
  const isRateLimited = dataWarning === "rate_limited";
  const isStale =
    isRateLimited ||
    (lastUpdatedMs !== null && Date.now() - lastUpdatedMs > 60_000);

  const vaultStatus = data?.paused
    ? "paused"
    : isStale
    ? "stale"
    : data !== null
    ? "live"
    : "stale";

  const agentHash = data?.agentAccountHash
    ? displayAccountHash(data.agentAccountHash)
    : "";

  const balanceParts = data
    ? formatCsprParts(data.totalBalanceMotes)
    : null;

  const isEmpty = data !== null && data.totalBalanceMotes === BigInt(0);

  return (
    <section
      className="panel"
      aria-labelledby="vault-heading"
      style={{ minHeight: "280px" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: "var(--space-3)",
        }}
      >
        <h2 id="vault-heading" className="panel-label">
          Vault Balance
        </h2>
        <StatusChip
          variant={vaultStatus as "live" | "paused" | "stale"}
          label={isRateLimited ? "RATE LIMITED" : undefined}
        />
      </div>

      {isRateLimited && (
        <p
          role="status"
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-warning)",
            marginBottom: "var(--space-3)",
            lineHeight: 1.4,
          }}
        >
          CSPR.cloud rate limited — showing cached or fallback vault data.
        </p>
      )}

      {/* Balance hero number */}
      <output
        aria-live="polite"
        aria-label="Total vault balance"
        style={{ display: "block", marginBottom: "var(--space-4)" }}
      >
        {isLoading && !data ? (
          <SkeletonBlock height="3.5rem" width="75%" />
        ) : (
          <span
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "var(--space-2)",
              fontFamily: "var(--font-mono)",
              fontWeight: "var(--weight-bold)",
              fontSize: "var(--text-3xl)",
              color: "var(--color-text-primary)",
              lineHeight: "var(--leading-tight)",
            }}
          >
            <span>
              {balanceParts?.integer ?? "0"}
              <span style={{ opacity: 0.6 }}>.{balanceParts?.fraction ?? "00"}</span>
            </span>
            <span
              style={{
                fontSize: "var(--text-lg)",
                color: "var(--color-text-secondary)",
                fontWeight: "var(--weight-regular)",
              }}
            >
              CSPR
            </span>
            {error && (
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-muted)",
                  fontFamily: "var(--font-body)",
                }}
              >
                (cached)
              </span>
            )}
          </span>
        )}
      </output>

      {/* Empty state prompt */}
      {isEmpty && !isLoading && (
        <p
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--color-text-secondary)",
            marginBottom: "var(--space-4)",
          }}
        >
          Deposit CSPR to begin earning yield through autonomous reallocation.
        </p>
      )}

      {/* Error message */}
      {error && (
        <p
          role="alert"
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-warning)",
            marginBottom: "var(--space-3)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-1)",
          }}
        >
          <WarningIcon />
          Vault data unavailable. Retrying in 15s.
        </p>
      )}

      {/* Shares */}
      <div style={{ marginBottom: "var(--space-4)" }}>
        <div className="panel-label">Shares Outstanding</div>
        {isLoading && !data ? (
          <SkeletonBlock height="1.5rem" width="60%" />
        ) : (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-xl)",
              color: "var(--color-text-primary)",
            }}
          >
            {data ? formatShares(data.totalShares) : "—"}
          </span>
        )}
      </div>

      <hr className="divider" />

      {/* Meta row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "var(--space-4)",
          marginBottom: "var(--space-4)",
        }}
      >
        <div>
          <div className="panel-label">Last Reallocation</div>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            {data?.lastReallocationTs
              ? relativeTime(
                  // lastReallocationTs is a UNIX timestamp in seconds from the contract;
                  // relativeTime expects milliseconds.
                  data.lastReallocationTs < 1_000_000_000_000
                    ? data.lastReallocationTs * 1000
                    : data.lastReallocationTs
                )
              : "—"}
          </span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="panel-label">Agent</div>
          {agentHash ? (
            <a
              href={`https://testnet.cspr.live/account/${agentHash}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View agent account ${agentHash} on cspr.live (opens in new tab)`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "2px",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-2xs)",
                color: "var(--color-text-secondary)",
                background: "var(--color-bg-void)",
                borderRadius: "var(--radius-sm)",
                padding: "2px var(--space-2)",
                textDecoration: "none",
              }}
            >
              {truncateHash(agentHash)}
              <ExternalIcon />
              <span className="sr-only"> (opens in new tab)</span>
            </a>
          ) : (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-2xs)",
                color: "var(--color-text-muted)",
              }}
            >
              —
            </span>
          )}
        </div>
      </div>

      <hr className="divider" />

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "var(--space-3)" }}>
        <Button
          variant="primary"
          onClick={() => setModalMode("deposit")}
          style={{ flex: 1 }}
        >
          Deposit CSPR
        </Button>
        <Button
          variant="secondary"
          onClick={() => setModalMode("withdraw")}
          style={{ flex: 1 }}
        >
          Withdraw
        </Button>
      </div>

      {/* Deposit / Withdraw Modal */}
      {modalMode && (
        <DepositWithdrawModal
          mode={modalMode}
          vaultData={data}
          onClose={() => setModalMode(null)}
        />
      )}
    </section>
  );
}

function WarningIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1L11 10H1L6 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M6 4v3M6 8.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M5.5 1H9V4.5M9 1L4.5 5.5M1 2h3v7H1V2z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
