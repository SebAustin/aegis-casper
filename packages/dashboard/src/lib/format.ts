/**
 * Number and string formatting utilities for the Aegis dashboard.
 * All formatters follow the microcopy guide in DESIGN.md §9.
 */

const MOTES_PER_CSPR = BigInt("1000000000"); // 1e9

/** Converts motes (bigint) to a human-readable CSPR string: "12,450.00 CSPR". */
export function formatCspr(motes: bigint): string {
  const cspr = Number(motes) / 1e9;
  return (
    cspr.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " CSPR"
  );
}

/** Formats CSPR balance with the fractional part separated for styling. */
export function formatCsprParts(motes: bigint): { integer: string; fraction: string } {
  const cspr = Number(motes) / Number(MOTES_PER_CSPR);
  const [integer = "0", fraction = "00"] = cspr
    .toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .split(".");
  return { integer, fraction };
}

/** Formats share count: "12,450.000000 AEGIS". */
export function formatShares(shares: bigint): string {
  const val = Number(shares) / 1e6;
  return (
    val.toLocaleString("en-US", {
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    }) + " AEGIS"
  );
}

/** Formats basis points as a percentage: 4250 → "42.5%". */
export function formatBps(bps: number): string {
  return (bps / 100).toFixed(1) + "%";
}

/** Formats APY in basis points: 624 → "6.24%". */
export function formatApyBps(apyBps: number): string {
  return (apyBps / 100).toFixed(2) + "%";
}

/** Truncates a hash for display: first 6 + … + last 4. */
export function truncateHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

/** Strips the "account-hash-" prefix for display. */
export function displayAccountHash(hash: string): string {
  return hash.replace(/^account-hash-/, "");
}

/**
 * Returns a relative time string for timestamps < 24h,
 * or an ISO date string for older entries.
 */
export function relativeTime(tsMs: number): string {
  const now = Date.now();
  const diffMs = now - tsMs;
  const diffS = Math.floor(diffMs / 1000);

  if (diffMs < 0) return "just now";
  if (diffS < 60) return `${diffS}s ago`;

  const diffM = Math.floor(diffS / 60);
  const remS = diffS % 60;
  if (diffM < 60) return `${diffM}m ${remS}s ago`;

  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;

  return new Date(tsMs).toISOString().slice(0, 10);
}

/** Formats a countdown in ms as "Ns". */
export function formatCountdown(ms: number): string {
  return `${Math.ceil(ms / 1000)}s`;
}

/** Returns the confidence badge class suffix based on score. */
export function confidenceClass(score: number): "high" | "mid" | "low" {
  if (score >= 80) return "high";
  if (score >= 60) return "mid";
  return "low";
}

/** Constructs a cspr.live testnet explorer URL for a deploy hash. */
export function explorerUrl(hash: string): string {
  const base =
    process.env["NEXT_PUBLIC_CASPER_EXPLORER_TX_BASE"] ??
    "https://testnet.cspr.live/deploy";
  return `${base}/${hash}`;
}

/** Returns the display label for an asset ID, with optional oracle name override. */
export function getAssetLabel(assetId: number, oracleName?: string): string {
  if (oracleName) return oracleName;
  const SLOT_LABELS = ["T-Bill", "Priv-Cr", "Commod", "Liq-St", "Other"] as const;
  return SLOT_LABELS[assetId] ?? `Asset ${assetId + 1}`;
}
