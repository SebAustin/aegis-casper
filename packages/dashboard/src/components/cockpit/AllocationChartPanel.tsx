"use client";

import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { AllocationMap, RwaAsset } from "@aegis/shared";
import type { PollStatus } from "@/hooks/usePoller";
import { formatBps, getAssetLabel } from "@/lib/format";
import { ASSET_META } from "@/lib/assetMeta";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";

interface Props {
  allocation: AllocationMap | null;
  oracleAssets: RwaAsset[] | null;
  status: PollStatus;
}

/**
 * DESIGN.md §6.5 — Animated Radial Ring (Donut Chart).
 * SVG-based, stroke-dasharray technique.
 * Accessible: role="img" + hidden <table> for screen readers.
 */
export function AllocationChartPanel({ allocation, oracleAssets, status }: Props) {
  const reduced = useReducedMotion();
  const isLoading = (status === "idle" || status === "loading") && !allocation;
  const isEmpty = allocation !== null && allocation.every((a) => a.bps === 0);

  // Chart dimensions
  const size = 240;
  const outerR = 110;
  const innerR = 72;
  const strokeW = outerR - innerR; // 38px
  const cx = size / 2;
  const cy = size / 2;
  const radius = (outerR + innerR) / 2; // 91px — midpoint of the stroke
  const circumference = 2 * Math.PI * radius;

  // Build arc segments
  type Segment = { assetId: number; bps: number; offset: number; dash: number; color: string; name: string };
  const segments: Segment[] = [];
  let totalBps = 0;

  if (allocation && !isEmpty) {
    let accumulatedOffset = 0;
    for (const entry of allocation) {
      const bps = Math.max(entry.bps, 30); // 3° minimum floor (DESIGN risk 3)
      const dash = (bps / 10_000) * circumference;
      const gap = 2; // 2px between segments
      const oracleName = oracleAssets?.find((a) => a.assetId === entry.assetId)?.name;
      segments.push({
        assetId: entry.assetId,
        bps: entry.bps,
        offset: circumference - accumulatedOffset,
        dash: dash - gap,
        color: ASSET_META[entry.assetId]?.color ?? "#888",
        name: getAssetLabel(entry.assetId, oracleName),
      });
      accumulatedOffset += dash;
    }
    totalBps = allocation.reduce((s, a) => s + a.bps, 0);
  }

  // Dominant allocation (largest segment)
  const dominant = allocation
    ? [...allocation].sort((a, b) => b.bps - a.bps)[0]
    : null;
  const dominantName = dominant
    ? getAssetLabel(
        dominant.assetId,
        oracleAssets?.find((a) => a.assetId === dominant.assetId)?.name
      )
    : null;
  const dominantPct = dominant && totalBps > 0
    ? ((dominant.bps / 10_000) * 100).toFixed(1)
    : null;

  return (
    <section
      className="panel"
      aria-labelledby="alloc-heading"
      style={{ minHeight: "280px", display: "flex", flexDirection: "column", alignItems: "center" }}
    >
      <h2 id="alloc-heading" className="panel-label sr-only">
        Portfolio Allocation
      </h2>

      {isLoading ? (
        <LoadingSkeleton size={size} strokeW={strokeW} cx={cx} cy={cy} radius={radius} circumference={circumference} />
      ) : isEmpty ? (
        <EmptyState size={size} cx={cx} cy={cy} radius={radius} circumference={circumference} strokeW={strokeW} />
      ) : (
        <>
          {/* The SVG donut chart */}
          <div
            role="img"
            aria-label="Current portfolio allocation"
            style={{ width: size, height: size, flexShrink: 0 }}
          >
            <svg
              width={size}
              height={size}
              viewBox={`0 0 ${size} ${size}`}
              aria-hidden="true"
              focusable="false"
            >
              {/* Background ring */}
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke="var(--color-border-subtle)"
                strokeWidth={strokeW}
              />
              {/* Segments */}
              {segments.map((seg) => (
                <circle
                  key={seg.assetId}
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={strokeW}
                  strokeDasharray={`${seg.dash} ${circumference - seg.dash}`}
                  strokeDashoffset={seg.offset}
                  strokeLinecap="butt"
                  transform={`rotate(-90 ${cx} ${cy})`}
                  style={{
                    transition: reduced
                      ? "none"
                      : `stroke-dasharray var(--duration-slow) var(--ease-out-expo), stroke-dashoffset var(--duration-slow) var(--ease-out-expo)`,
                  }}
                />
              ))}
              {/* Center label */}
              {dominantName && (
                <>
                  <text
                    x={cx}
                    y={cy - 8}
                    textAnchor="middle"
                    fill="var(--color-text-secondary)"
                    fontSize="11"
                    fontFamily="var(--font-body)"
                    letterSpacing="0.08em"
                  >
                    {dominantName.toUpperCase().slice(0, 8)}
                  </text>
                  <text
                    x={cx}
                    y={cy + 14}
                    textAnchor="middle"
                    fill="var(--color-text-primary)"
                    fontSize="22"
                    fontFamily="var(--font-mono)"
                    fontWeight="700"
                  >
                    {dominantPct}%
                  </text>
                </>
              )}
            </svg>
          </div>

          {/* Legend */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--space-2)",
              marginTop: "var(--space-4)",
              justifyContent: "center",
            }}
          >
            {segments.map((seg, i) => (
              <div
                key={seg.assetId}
                role="listitem"
                tabIndex={0}
                aria-label={`${seg.name}: ${formatBps(seg.bps)}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  padding: "2px var(--space-2)",
                  borderRadius: "var(--radius-xs)",
                  background:
                    i === 0 ? "var(--color-bg-raised)" : "transparent",
                  border: "1px solid var(--color-border-subtle)",
                }}
              >
                {/* Color swatch + letter for color-blind users (DESIGN risk 6) */}
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "14px",
                    height: "14px",
                    borderRadius: "var(--radius-xs)",
                    background: seg.color,
                    fontSize: "8px",
                    fontWeight: "700",
                    color: "#000",
                    flexShrink: 0,
                  }}
                >
                  {ASSET_META[seg.assetId]?.letter}
                </span>
                <span
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--color-text-secondary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {seg.name}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-xs)",
                    color: "var(--color-text-primary)",
                  }}
                >
                  {formatBps(seg.bps)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Hidden accessible table for screen readers */}
      <table className="sr-only">
        <caption>Current portfolio allocation</caption>
        <thead>
          <tr>
            <th scope="col">Asset</th>
            <th scope="col">Basis Points</th>
            <th scope="col">Percentage</th>
          </tr>
        </thead>
        <tbody>
          {(allocation ?? []).map((entry) => {
            const oracleName = oracleAssets?.find((a) => a.assetId === entry.assetId)?.name;
            return (
              <tr key={entry.assetId}>
                <td>{getAssetLabel(entry.assetId, oracleName)}</td>
                <td>{entry.bps}</td>
                <td>{formatBps(entry.bps)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function LoadingSkeleton({ size, strokeW, cx, cy, radius, circumference }: {
  size: number; strokeW: number; cx: number; cy: number; radius: number; circumference: number;
}) {
  const SKELETON_ARCS = [
    { offset: 0,                         dash: circumference * 0.42 },
    { offset: -(circumference * 0.42),   dash: circumference * 0.28 },
    { offset: -(circumference * 0.70),   dash: circumference * 0.30 },
  ];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke="var(--color-border-subtle)"
        strokeWidth={strokeW}
      />
      {SKELETON_ARCS.map((arc, i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="var(--color-bg-panel)"
          strokeWidth={strokeW}
          strokeDasharray={`${arc.dash - 2} ${circumference - arc.dash + 2}`}
          strokeDashoffset={circumference - arc.offset}
          transform={`rotate(-90 ${cx} ${cy})`}
          className="skeleton"
        />
      ))}
      <text x={cx} y={cy + 6} textAnchor="middle" fill="var(--color-text-muted)" fontSize="18" fontFamily="var(--font-mono)">
        —
      </text>
    </svg>
  );
}

function EmptyState({ size, cx, cy, radius, circumference, strokeW }: {
  size: number; cx: number; cy: number; radius: number; circumference: number; strokeW: number;
}) {
  return (
    <>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="var(--color-border-subtle)"
          strokeWidth={strokeW}
          strokeDasharray={`${circumference} 0`}
        />
        <text x={cx} y={cy - 6} textAnchor="middle" fill="var(--color-text-muted)" fontSize="11" fontFamily="var(--font-body)">
          No allocation
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="var(--color-text-muted)" fontSize="10" fontFamily="var(--font-body)">
          set
        </text>
      </svg>
      <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", textAlign: "center", marginTop: "var(--space-3)" }}>
        The agent will set an allocation on its first run.
      </p>
    </>
  );
}
