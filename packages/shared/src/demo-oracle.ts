/**
 * Deterministic demo RWA oracle snapshot for offline / degraded runs.
 * Mirrors packages/oracle seed assets so dashboard and agent stay aligned.
 */

import type { RwaAsset, RwaOracleData } from "./types.js";

const BASE_ASSETS: Omit<RwaAsset, "dataFreshnessMs">[] = [
  {
    assetId: 0,
    name: "Tokenized T-Bills",
    apyBps: 510,
    riskScore: 10,
    liquidityScore: 90,
  },
  {
    assetId: 1,
    name: "Tokenized Private Credit",
    apyBps: 850,
    riskScore: 45,
    liquidityScore: 50,
  },
  {
    assetId: 2,
    name: "Tokenized Commodities",
    apyBps: 320,
    riskScore: 35,
    liquidityScore: 65,
  },
  {
    assetId: 3,
    name: "Stable Yield",
    apyBps: 470,
    riskScore: 8,
    liquidityScore: 95,
  },
  {
    assetId: 4,
    name: "CSPR Liquid Staking",
    apyBps: 630,
    riskScore: 25,
    liquidityScore: 80,
  },
];

/** Build a schema-valid oracle payload when the live oracle is unreachable. */
export function buildDemoOracleSnapshot(
  payerAccountHash = "demo-agent"
): RwaOracleData {
  const now = Date.now();
  const driftSeed = Math.floor(now / 60_000);

  const assets: RwaAsset[] = BASE_ASSETS.map((asset) => {
    const drift = Math.round(Math.sin((driftSeed + asset.assetId) * 2.1) * 30);
    return {
      ...asset,
      apyBps: Math.max(0, asset.apyBps + drift),
      dataFreshnessMs: now,
    };
  });

  return {
    timestamp: now,
    oracleVersion: "demo-fallback",
    paymentReceipt: {
      paymentHash: "demo-oracle-unavailable",
      facilitator: "mock",
      amountMotes: BigInt(0),
      payerAccountHash,
      expiry: Math.floor(now / 1000) + 300,
      confirmedAt: Math.floor(now / 1000),
    },
    assets,
  };
}
