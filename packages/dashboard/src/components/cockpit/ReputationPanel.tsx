"use client";

import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { AgentReputation } from "@aegis/shared";
import type { PollStatus } from "@/hooks/usePoller";
import { relativeTime } from "@/lib/format";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";

interface Props {
  data: AgentReputation | null;
  status: PollStatus;
  error: string | null;
}

const MAX_SCORE = 1000;
// Arc gauge: 180° sweep, semicircle
const GAUGE_W = 160;
const GAUGE_H = 90;
const GAUGE_CX = GAUGE_W / 2;
const GAUGE_CY = GAUGE_H;
const GAUGE_R = 65;
const STROKE_W = 12;
const ARC_CIRCUMFERENCE = Math.PI * GAUGE_R; // half-circle arc length

/**
 * DESIGN.md §6.6 — Agent Reputation Panel.
 * FR-D-02.
 *
 * Accessibility: role="meter" on the gauge.
 */
export function ReputationPanel({ data, status, error }: Props) {
  const reduced = useReducedMotion();
  const isLoading = (status === "idle" || status === "loading") && !data;

  const score = data ? Number(data.score) : 0;
  const totalDecisions = data ? Number(data.totalDecisions) : 0;
  const correctPredictions = data ? Number(data.correctPredictions) : 0;
  const accuracy =
    totalDecisions > 0
      ? ((correctPredictions / totalDecisions) * 100).toFixed(1) + "%"
      : "—";

  // Gauge fill: fraction from 0 to 1
  const fill = Math.min(score / MAX_SCORE, 1);
  // stroke-dashoffset: full = not filled, 0 = fully filled
  const dashOffset = ARC_CIRCUMFERENCE * (1 - fill);

  // Accuracy color
  const accuracyNum = totalDecisions > 0 ? (correctPredictions / totalDecisions) * 100 : -1;
  const accuracyColor =
    accuracyNum >= 80
      ? "var(--color-positive)"
      : accuracyNum >= 60
      ? "var(--color-warning)"
      : accuracyNum >= 0
      ? "var(--color-danger)"
      : "var(--color-text-secondary)";

  return (
    <section
      className="panel"
      aria-labelledby="rep-heading"
      style={{ minHeight: "280px", display: "flex", flexDirection: "column", alignItems: "center" }}
    >
      <h2 id="rep-heading" className="panel-label" style={{ alignSelf: "flex-start" }}>
        Agent Reputation
      </h2>

      {/* Arc Gauge */}
      <div
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={MAX_SCORE}
        aria-label={`Agent reputation score: ${score} out of ${MAX_SCORE}`}
        style={{ marginTop: "var(--space-2)", marginBottom: "var(--space-2)" }}
      >
        <svg
          width={GAUGE_W}
          height={GAUGE_H + 20}
          viewBox={`0 0 ${GAUGE_W} ${GAUGE_H + 20}`}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="var(--color-rep-low)" />
              <stop offset="50%"  stopColor="var(--color-rep-mid)" />
              <stop offset="100%" stopColor="var(--color-rep-high)" />
            </linearGradient>
          </defs>
          {/* Background arc */}
          <path
            d={describeArc(GAUGE_CX, GAUGE_CY, GAUGE_R, 180, 360)}
            fill="none"
            stroke="var(--color-border-subtle)"
            strokeWidth={STROKE_W}
            strokeLinecap="round"
          />
          {/* Foreground arc */}
          {!isLoading && (
            <path
              d={describeArc(GAUGE_CX, GAUGE_CY, GAUGE_R, 180, 360)}
              fill="none"
              stroke="url(#gaugeGrad)"
              strokeWidth={STROKE_W}
              strokeLinecap="round"
              strokeDasharray={ARC_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              style={{
                transition: reduced
                  ? "none"
                  : `stroke-dashoffset var(--duration-slow) var(--ease-spring)`,
              }}
            />
          )}
          {/* Score text */}
          <text
            x={GAUGE_CX}
            y={GAUGE_CY - 4}
            textAnchor="middle"
            fill="var(--color-text-primary)"
            fontSize="28"
            fontFamily="var(--font-mono)"
            fontWeight="700"
          >
            {isLoading ? "—" : score}
          </text>
          <text
            x={GAUGE_CX}
            y={GAUGE_CY + 14}
            textAnchor="middle"
            fill="var(--color-text-secondary)"
            fontSize="10"
            fontFamily="var(--font-body)"
            letterSpacing="0.08em"
          >
            SCORE
          </text>
        </svg>
      </div>

      {error && (
        <div
          style={{
            fontSize: "var(--text-2xs)",
            color: "var(--color-warning)",
            marginBottom: "var(--space-2)",
          }}
        >
          Score unavailable
        </div>
      )}

      <hr className="divider" style={{ width: "100%" }} />

      {/* Stat row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "var(--space-2)",
          width: "100%",
          textAlign: "center",
        }}
      >
        <StatCell label="DECISIONS" value={isLoading ? null : String(totalDecisions)} />
        <StatCell label="CORRECT" value={isLoading ? null : String(correctPredictions)} />
        <StatCell
          label="ACC."
          value={isLoading ? null : accuracy}
          color={isLoading ? undefined : accuracyColor}
        />
      </div>

      {data?.registeredTs && (
        <p
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
            marginTop: "var(--space-3)",
            alignSelf: "flex-start",
          }}
        >
          Updated {relativeTime(data.registeredTs)}
        </p>
      )}
    </section>
  );
}

function StatCell({
  label,
  value,
  color,
}: {
  label: string;
  value: string | null;
  color?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: "var(--text-2xs)",
          color: "var(--color-text-muted)",
          fontWeight: "var(--weight-semibold)",
          letterSpacing: "var(--tracking-widest)",
          textTransform: "uppercase",
          marginBottom: "var(--space-1)",
        }}
      >
        {label}
      </div>
      {value === null ? (
        <SkeletonBlock height="1.25rem" width="60%" style={{ margin: "0 auto" }} />
      ) : (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-md)",
            color: color ?? "var(--color-text-primary)",
            fontWeight: "var(--weight-semibold)",
          }}
        >
          {value}
        </span>
      )}
    </div>
  );
}

/**
 * Generates an SVG arc path string.
 * startAngle/endAngle in degrees, measured clockwise from positive-x axis.
 */
function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
): string {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(startAngle));
  const y1 = cy + r * Math.sin(toRad(startAngle));
  const x2 = cx + r * Math.cos(toRad(endAngle));
  const y2 = cy + r * Math.sin(toRad(endAngle));
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}
