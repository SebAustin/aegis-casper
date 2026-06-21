"use client";

import type { RwaOracleData } from "@aegis/shared";
import type { PollStatus } from "@/hooks/usePoller";
import { formatApyBps, relativeTime } from "@/lib/format";
import { StatusChip } from "@/components/ui/StatusChip";
import { TxHashChip } from "@/components/ui/TxHashChip";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";

interface Props {
  data: RwaOracleData | null;
  dataSource?: string;
  status: PollStatus;
  error: string | null;
}

/**
 * DESIGN.md §6.8 — Oracle / x402 Panel.
 * FR-D-04.
 */
export function OraclePanel({ data, dataSource, status, error }: Props) {
  const isLoading = (status === "idle" || status === "loading") && !data;
  const isOfflineSource =
    dataSource === "demo" || dataSource === "payments-log";

  const freshness = data
    ? Date.now() - data.timestamp
    : null;

  const freshnessVariant =
    freshness === null
      ? "stale"
      : freshness < 30_000
      ? "fresh"
      : freshness < 60_000
      ? "aging"
      : "stale";

  return (
    <section
      className="panel"
      aria-labelledby="oracle-heading"
      style={{ minHeight: "320px" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--space-4)",
        }}
      >
        <div>
          <h2 id="oracle-heading" className="panel-label" style={{ margin: 0 }}>
            RWA Oracle · x402 Gated
          </h2>
        </div>
        <StatusChip variant={freshnessVariant as "fresh" | "aging" | "stale"} />
      </div>

      {isOfflineSource && (
        <p
          role="status"
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-warning)",
            marginBottom: "var(--space-3)",
            padding: "var(--space-2) var(--space-3)",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-warning-10, rgba(234, 179, 8, 0.08))",
            border: "1px solid var(--color-warning)",
            lineHeight: 1.45,
          }}
        >
          Oracle service offline — showing{" "}
          {dataSource === "payments-log" ? "cached payment" : "demo"} yields.
          Run <code style={{ fontFamily: "var(--font-mono)" }}>pnpm oracle</code>{" "}
          (port 4021), then refresh. Agent needs oracle before{" "}
          <code style={{ fontFamily: "var(--font-mono)" }}>pnpm agent</code> for
          live x402 data.
        </p>
      )}

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
          Oracle data unavailable — x402 payment may have failed.
          {data && <span style={{ color: "var(--color-text-muted)" }}>(cached)</span>}
        </p>
      )}

      {!data && !isLoading && !error && (
        <div style={{ padding: "var(--space-8) 0", textAlign: "center" }}>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-1)" }}>
            Awaiting oracle data
          </p>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
            The agent will fetch yield data on its next run.
          </p>
        </div>
      )}

      {/* Asset table */}
      <table
        style={{ width: "100%", borderCollapse: "collapse" }}
        aria-label="RWA asset yield data"
      >
        <thead>
          <tr>
            {["Asset", "APY", "Risk", "Liquidity"].map((col) => (
              <th
                key={col}
                scope="col"
                style={{
                  textAlign: "left",
                  fontSize: "var(--text-2xs)",
                  fontWeight: "var(--weight-semibold)",
                  letterSpacing: "var(--tracking-widest)",
                  textTransform: "uppercase",
                  color: "var(--color-text-muted)",
                  paddingBottom: "var(--space-2)",
                  borderBottom: "1px solid var(--color-border-subtle)",
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? [0, 1, 2, 3, 4].map((i) => (
                <tr key={i}>
                  {[0, 1, 2, 3].map((j) => (
                    <td key={j} style={{ padding: "var(--space-3) var(--space-1) var(--space-3) 0" }}>
                      <SkeletonBlock height="0.875rem" width={j === 0 ? "80px" : "50px"} />
                    </td>
                  ))}
                </tr>
              ))
            : (data?.assets ?? []).map((asset) => (
                <tr key={asset.assetId}>
                  <td
                    style={{
                      padding: "var(--space-3) var(--space-2) var(--space-3) 0",
                      fontSize: "var(--text-sm)",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {asset.name}
                  </td>
                  <td
                    style={{
                      padding: "var(--space-3) var(--space-2)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--text-sm)",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {formatApyBps(asset.apyBps)}
                  </td>
                  <td style={{ padding: "var(--space-3) var(--space-2)" }}>
                    <ScoreBar score={asset.riskScore} invert />
                  </td>
                  <td style={{ padding: "var(--space-3) var(--space-2)" }}>
                    <ScoreBar score={asset.liquidityScore} />
                  </td>
                </tr>
              ))}
        </tbody>
      </table>

      {/* Payment receipt */}
      {data?.paymentReceipt?.paymentHash && (
        <>
          <hr className="divider" />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: "var(--text-2xs)",
                fontWeight: "var(--weight-semibold)",
                letterSpacing: "var(--tracking-widest)",
                textTransform: "uppercase",
                color: "var(--color-text-muted)",
              }}
            >
              Payment Receipt
            </span>
            <TxHashChip hash={data.paymentReceipt.paymentHash} showCopy />
            <span
              style={{
                fontSize: "var(--text-2xs)",
                color: "var(--color-text-muted)",
                fontFamily: "var(--font-mono)",
              }}
            >
              · Paid via x402
            </span>
          </div>
        </>
      )}

      {data?.timestamp && (
        <p
          style={{
            marginTop: "var(--space-3)",
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          Updated {relativeTime(data.timestamp)}
        </p>
      )}
    </section>
  );
}

/** Inline bar (4px tall, 48px wide) + numeric score. */
function ScoreBar({ score, invert = false }: { score: number; invert?: boolean }) {
  const pct = Math.min(100, Math.max(0, score));
  // For risk: higher is worse → color maps danger
  // For liquidity: higher is better → color maps positive
  const color =
    invert
      ? score < 30
        ? "var(--color-positive)"
        : score < 60
        ? "var(--color-warning)"
        : "var(--color-danger)"
      : score > 70
      ? "var(--color-positive)"
      : score > 40
      ? "var(--color-warning)"
      : "var(--color-danger)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        whiteSpace: "nowrap",
      }}
    >
      <div
        style={{
          width: "48px",
          height: "4px",
          background: "var(--color-border-subtle)",
          borderRadius: "var(--radius-xs)",
          overflow: "hidden",
          flexShrink: 0,
        }}
        role="presentation"
        aria-hidden="true"
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            borderRadius: "var(--radius-xs)",
          }}
        />
      </div>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-xs)",
          color: "var(--color-text-secondary)",
        }}
      >
        {score}/100
      </span>
    </div>
  );
}
