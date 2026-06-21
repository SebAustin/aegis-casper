/**
 * Loop-cadence resolution — keeps the agent within the CSPR.cloud free-tier
 * daily request quota in online mode while staying lively in offline demo.
 *
 * Background: cspr.cloud's free tier caps requests at ~1200/day per API key.
 * Each loop iteration performs ~2 reads (vault + reputation), so a 30s cadence
 * is ~5,760 reads/day — it exhausts the quota in hours and the agent then 429s
 * and can never act. The quota-safe online default is 15 minutes (~192/day).
 * Offline demo makes zero network calls, so it runs fast regardless.
 */

/** Online default cadence (15 min) — well under the free-tier daily quota. */
export const QUOTA_SAFE_INTERVAL_MS = 900_000;

/** Below this online cadence, a free-tier key will likely exhaust its quota. */
export const QUOTA_RISKY_BELOW_MS = 120_000;

/** Offline demo never reads the chain, so cap to a lively cadence for the UI. */
export const DEMO_MAX_INTERVAL_MS = 15_000;

/**
 * Resolve the effective loop interval.
 * - Offline demo: at most {@link DEMO_MAX_INTERVAL_MS} (use a faster explicit
 *   value if the operator set one — there is no quota cost offline).
 * - Online: honour the configured value verbatim.
 */
export function resolveLoopIntervalMs(
  offlineDemo: boolean,
  configuredMs: number
): number {
  if (offlineDemo) return Math.min(configuredMs, DEMO_MAX_INTERVAL_MS);
  return configuredMs;
}

/**
 * True when an ONLINE run is configured at a cadence likely to blow the
 * cspr.cloud free-tier daily quota. Offline demo is never at risk.
 */
export function isQuotaRiskyCadence(
  offlineDemo: boolean,
  configuredMs: number
): boolean {
  return !offlineDemo && configuredMs < QUOTA_RISKY_BELOW_MS;
}
