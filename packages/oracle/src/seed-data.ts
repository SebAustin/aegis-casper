/**
 * Deterministic seeded RWA asset data (A-005).
 *
 * 5 simulated asset slots:
 *   0 – Tokenized T-Bills
 *   1 – Tokenized Private Credit
 *   2 – Tokenized Commodities
 *   3 – Stable Yield
 *   4 – CSPR Liquid Staking
 *
 * In demo mode, APY values drift slightly each refresh cycle to ensure
 * the agent loop's drift gate fires (RISK-06 mitigation).
 */

import type { RwaAsset } from "@aegis/shared";

const BASE_ASSETS: Omit<RwaAsset, "dataFreshnessMs">[] = [
  {
    assetId: 0,
    name: "Tokenized T-Bills",
    apyBps: 510,    // ~5.1% APY
    riskScore: 10,
    liquidityScore: 90,
  },
  {
    assetId: 1,
    name: "Tokenized Private Credit",
    apyBps: 850,    // ~8.5% APY
    riskScore: 45,
    liquidityScore: 50,
  },
  {
    assetId: 2,
    name: "Tokenized Commodities",
    apyBps: 320,    // ~3.2% APY
    riskScore: 35,
    liquidityScore: 65,
  },
  {
    assetId: 3,
    name: "Stable Yield",
    apyBps: 470,    // ~4.7% APY
    riskScore: 8,
    liquidityScore: 95,
  },
  {
    assetId: 4,
    name: "CSPR Liquid Staking",
    apyBps: 630,    // ~6.3% APY
    riskScore: 25,
    liquidityScore: 80,
  },
];

/**
 * Generate the current RWA asset snapshot.
 *
 * In demo mode each call adds a small deterministic drift (+/- 30 bps)
 * based on the current minute so the agent loop reliably sees yield changes.
 */
export function generateAssets(demoMode = true): RwaAsset[] {
  const now = Date.now();
  // Drift cycles every minute so assets are stable within a minute but shift across minutes
  const driftSeed = demoMode ? Math.floor(now / 60_000) : 0;

  return BASE_ASSETS.map((asset) => {
    const drift = demoMode
      ? Math.round(Math.sin((driftSeed + asset.assetId) * 2.1) * 30)
      : 0;
    return {
      ...asset,
      apyBps: Math.max(0, asset.apyBps + drift),
      dataFreshnessMs: now,
    };
  });
}
