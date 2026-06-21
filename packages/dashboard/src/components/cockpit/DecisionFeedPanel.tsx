"use client";

import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { DecisionLogEntry } from "@aegis/shared";
import type { PollStatus } from "@/hooks/usePoller";
import {
  relativeTime,
  confidenceClass,
  formatBps,
  formatCountdown,
  formatSkipReason,
  getAssetLabel,
} from "@/lib/format";
import { TxHashChip } from "@/components/ui/TxHashChip";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";

interface Props {
  entries: DecisionLogEntry[] | null;
  status: PollStatus;
  error: string | null;
  countdown: number;
  refetch?: () => void;
}

/**
 * DESIGN.md §6.7 — Decision Feed Panel.
 * FR-D-03.
 *
 * Accessibility:
 * - role="log" aria-live="polite" aria-relevant="additions" aria-atomic="false"
 * - Scroll container shows 4 rows before scroll.
 */
export function DecisionFeedPanel({ entries, status, error, countdown, refetch }: Props) {
  const reduced = useReducedMotion();
  const isLoading = (status === "idle" || status === "loading") && !entries;
  const isEmpty = entries !== null && entries.length === 0;

  return (
    <section
      className="panel"
      aria-labelledby="feed-heading"
      style={{ minHeight: "320px", display: "flex", flexDirection: "column" }}
    >
      {/* Panel header with poll progress bar */}
      <div style={{ marginBottom: "var(--space-3)" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "var(--space-2)",
          }}
        >
          <h2 id="feed-heading" className="panel-label" style={{ margin: 0 }}>
            Decision Feed
          </h2>
          {reduced ? (
            <span
              aria-label={`Next update in ${formatCountdown(countdown)}`}
              style={{ fontSize: "var(--text-2xs)", color: "var(--color-text-muted)" }}
            >
              Next update in {formatCountdown(countdown)}
            </span>
          ) : (
            <span
              aria-label={`Next update in ${formatCountdown(countdown)}`}
              className="sr-only"
            />
          )}
        </div>
        {/* Poll progress bar */}
        {!reduced && (
          <div
            style={{
              height: "2px",
              background: "var(--color-border-subtle)",
              borderRadius: "var(--radius-xs)",
              overflow: "hidden",
            }}
          >
            <div
              className="poll-bar"
              key={String(entries?.length ?? 0)} // restart animation when new data arrives
              style={{ width: "100%", height: "100%" }}
            />
          </div>
        )}
      </div>

      {error && (
        <p
          role="alert"
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-danger)",
            marginBottom: "var(--space-3)",
          }}
        >
          Could not load decision history.
          <button
            type="button"
            onClick={refetch}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-accent-gold)",
              fontSize: "inherit",
              marginLeft: "var(--space-2)",
            }}
          >
            Retry
          </button>
        </p>
      )}

      {/* Feed region */}
      <div
        role="log"
        aria-label="Agent decision feed"
        aria-live="polite"
        aria-relevant="additions"
        aria-atomic="false"
        style={{
          flex: 1,
          overflowY: "auto",
          // Show 4 rows (~80px each) before scroll
          maxHeight: "320px",
          scrollBehavior: "smooth",
        }}
      >
        {isLoading && (
          <>
            {[0, 1, 2].map((i) => (
              <FeedItemSkeleton key={i} />
            ))}
          </>
        )}

        {isEmpty && !isLoading && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "var(--space-10) var(--space-4)",
              gap: "var(--space-3)",
              textAlign: "center",
            }}
          >
            <ClockIcon />
            <div>
              <div
                style={{
                  fontSize: "var(--text-md)",
                  color: "var(--color-text-secondary)",
                  fontWeight: "var(--weight-medium)",
                  marginBottom: "var(--space-1)",
                }}
              >
                No decisions yet
              </div>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)", margin: 0 }}>
                The agent loop has not run. Trigger a run to see live decisions.
              </p>
            </div>
          </div>
        )}

        {(entries ?? []).map((entry, i) => (
          <FeedItem key={`${entry.iteration}-${entry.timestamp}`} entry={entry} isNew={i === 0} />
        ))}
      </div>
    </section>
  );
}

function FeedItem({ entry, isNew }: { entry: DecisionLogEntry; isNew: boolean }) {
  const cls = isNew ? "feed-item-new" : "";
  const cc = confidenceClass(entry.confidence);

  const statusColor = entry.acted
    ? "var(--color-accent-gold)"
    : entry.skipReason
    ? "var(--color-text-muted)"
    : "var(--color-danger)";

  return (
    <div
      className={cls}
      style={{
        padding: "var(--space-3) 0",
        borderBottom: "1px solid var(--color-border-subtle)",
        opacity: entry.skipReason ? 0.7 : 1,
      }}
    >
      {/* Row 1: status icon + time + confidence */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--space-1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <StatusIcon acted={entry.acted} hasError={!entry.acted && !entry.skipReason} color={statusColor} />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-xs)",
              color: "var(--color-text-muted)",
            }}
          >
            {relativeTime(entry.timestamp)}
          </span>
        </div>
        <ConfidenceBadge score={entry.confidence} cls={cc} />
      </div>

      {/* Row 2: rationale */}
      <p
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "var(--text-sm)",
          color: "var(--color-text-secondary)",
          margin: "var(--space-1) 0 var(--space-2) 0",
          lineHeight: "var(--leading-snug)",
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}
      >
        {entry.rationale}
      </p>

      {/* Row 3: allocation micro-pills (only if acted) */}
      {entry.acted && entry.recommendedAllocation.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-1)",
            marginBottom: "var(--space-2)",
          }}
        >
          {entry.recommendedAllocation.slice(0, 5).map((a) => (
            <span
              key={a.assetId}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-2xs)",
                borderRadius: "var(--radius-xs)",
                border: "1px solid var(--color-border-subtle)",
                padding: "1px var(--space-2)",
                color: "var(--color-text-secondary)",
              }}
            >
              {getAssetLabel(a.assetId).replace("Asset ", "A")}{" "}
              {formatBps(a.bps)}
            </span>
          ))}
        </div>
      )}

      {/* Row 4: tx hash */}
      {entry.txHash && <TxHashChip hash={entry.txHash} />}

      {/* Skip reason */}
      {entry.skipReason && (
        <span
          style={{
            fontSize: "var(--text-2xs)",
            color: "var(--color-text-muted)",
          }}
        >
          Skipped: {formatSkipReason(entry.skipReason)}
        </span>
      )}
    </div>
  );
}

function ConfidenceBadge({ score, cls }: { score: number; cls: string }) {
  return (
    <span
      className={`chip confidence--${cls}`}
      aria-label={`Confidence: ${score}`}
    >
      {score}
    </span>
  );
}

function StatusIcon({ acted, hasError, color }: { acted: boolean; hasError: boolean; color: string }) {
  if (acted) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-label="Reallocated" style={{ color }}>
        <path d="M3 5l4-4 4 4M11 9l-4 4-4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (hasError) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-label="Error" style={{ color }}>
        <path d="M7 2L12 11H2L7 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M7 5.5v3M7 10v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-label="Skipped" style={{ color }}>
      <path d="M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function FeedItemSkeleton() {
  return (
    <div style={{ padding: "var(--space-3) 0", borderBottom: "1px solid var(--color-border-subtle)" }}>
      <div style={{ display: "flex", gap: "var(--space-3)", marginBottom: "var(--space-2)" }}>
        <SkeletonBlock width="60px" height="0.75rem" />
        <SkeletonBlock width="80px" height="0.75rem" />
      </div>
      <SkeletonBlock height="0.875rem" style={{ marginBottom: "var(--space-1)" }} />
      <SkeletonBlock width="80%" height="0.875rem" />
    </div>
  );
}

function ClockIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true" style={{ color: "var(--color-text-muted)" }}>
      <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="2" />
      <path d="M16 9v7l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
