/**
 * Self-contained demo decision generator for the hosted (serverless) dashboard.
 *
 * When the dashboard is deployed to Vercel with no live agent process and no
 * `logs/decisions.jsonl` on disk, `NEXT_PUBLIC_DEMO_MODE=true` switches
 * `/api/decisions` and `/api/trigger` to this pure, dependency-free generator
 * instead of returning an empty feed or a dead 503.
 *
 * No LLM call, no chain read/write, no persistence — every entry is a plain
 * `DecisionLogEntry` (see ./types.ts) built from a small set of hand-written
 * scenarios that reference the same five demo asset names as
 * ./demo-oracle.ts. Every generated `txHash` is prefixed `demo-reallocate-…`
 * so it can never be mistaken for a real on-chain transaction.
 */

import { createHash } from "node:crypto";
import type { AllocationMap, DecisionLogEntry } from "./types.js";

/** Reasons a demo iteration can skip acting, mirroring real agent skip codes. */
const DEMO_SKIP_REASONS = [
  "drift_below_threshold",
  "confidence_below_threshold",
  "cooldown_active",
] as const;

/** Probability a generated demo decision results in a simulated reallocation. */
const DEMO_ACT_PROBABILITY = 0.6;

interface DemoScenario {
  allocation: AllocationMap;
  confidence: number;
  rationale: string;
}

/**
 * Six hand-written allocation scenarios. Each sums to exactly 10_000 bps
 * across the 5 demo asset slots and keeps every slot at or below the default
 * 6000 bps sanity cap (see ./allocation.ts `allocationSanityCheck`).
 */
const DEMO_SCENARIOS: DemoScenario[] = [
  {
    allocation: [
      { assetId: 0, bps: 3500 },
      { assetId: 1, bps: 2500 },
      { assetId: 2, bps: 1500 },
      { assetId: 3, bps: 1500 },
      { assetId: 4, bps: 1000 },
    ],
    confidence: 82,
    rationale:
      "Tokenized T-Bills yield ticked up while Private Credit spreads widened; shifting weight toward the safer T-Bill sleeve protects risk-adjusted return this epoch.",
  },
  {
    allocation: [
      { assetId: 0, bps: 2000 },
      { assetId: 1, bps: 3000 },
      { assetId: 2, bps: 1500 },
      { assetId: 3, bps: 1500 },
      { assetId: 4, bps: 2000 },
    ],
    confidence: 74,
    rationale:
      "Tokenized Private Credit's APY premium over Stable Yield widened past the drift band; increasing Private Credit weight while keeping CSPR Staking steady for liquidity.",
  },
  {
    allocation: [
      { assetId: 0, bps: 2500 },
      { assetId: 1, bps: 1500 },
      { assetId: 2, bps: 3000 },
      { assetId: 3, bps: 1500 },
      { assetId: 4, bps: 1500 },
    ],
    confidence: 67,
    rationale:
      "Tokenized Commodities showed a freshness-adjusted APY spike; tilting toward Commodities while trimming Private Credit given its elevated risk score this cycle.",
  },
  {
    allocation: [
      { assetId: 0, bps: 3000 },
      { assetId: 1, bps: 2000 },
      { assetId: 2, bps: 1000 },
      { assetId: 3, bps: 3000 },
      { assetId: 4, bps: 1000 },
    ],
    confidence: 88,
    rationale:
      "Stable Yield's liquidity score remains highest across the basket; rebalancing toward Stable Yield and T-Bills ahead of an anticipated volatility window.",
  },
  {
    allocation: [
      { assetId: 0, bps: 1500 },
      { assetId: 1, bps: 2000 },
      { assetId: 2, bps: 1500 },
      { assetId: 3, bps: 2000 },
      { assetId: 4, bps: 3000 },
    ],
    confidence: 71,
    rationale:
      "CSPR Liquid Staking APY outpaced the basket average and its liquidity score held; increasing the staking sleeve while holding Commodities flat.",
  },
  {
    allocation: [
      { assetId: 0, bps: 2000 },
      { assetId: 1, bps: 1500 },
      { assetId: 2, bps: 1500 },
      { assetId: 3, bps: 2500 },
      { assetId: 4, bps: 2500 },
    ],
    confidence: 60,
    rationale:
      "Signals were mixed this cycle — Private Credit and Commodities risk scores rose in tandem with only a modest APY edge, so the recommended shift stays conservative.",
  },
];

function demoHash(label: string, seed: number | string): string {
  return createHash("sha256").update(`demo:${label}:${seed}`).digest("hex");
}

function pickSkipReason(random: () => number): string {
  const index = Math.min(
    Math.floor(random() * DEMO_SKIP_REASONS.length),
    DEMO_SKIP_REASONS.length - 1
  );
  return DEMO_SKIP_REASONS[index] ?? DEMO_SKIP_REASONS[0];
}

function pickScenario(index: number): DemoScenario {
  return DEMO_SCENARIOS[index % DEMO_SCENARIOS.length] ?? DEMO_SCENARIOS[0]!;
}

export interface GenerateDemoDecisionOptions {
  /** Epoch ms to stamp the entry with (default: `Date.now()`). */
  now?: number;
  /** Injectable RNG for deterministic tests (default: `Math.random`). */
  random?: () => number;
}

/**
 * Generate a single fresh demo `DecisionLogEntry`, as if the agent had just
 * run one iteration. Pure function — no I/O, no persistence.
 *
 * ~60% of calls simulate an on-chain reallocation (`acted: true` with a
 * `demo-reallocate-<timestamp>` txHash); the remainder simulate a skipped
 * iteration with a plausible `skipReason`.
 */
export function generateDemoDecision(
  options: GenerateDemoDecisionOptions = {}
): DecisionLogEntry {
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now();
  const scenario = pickScenario(Math.floor(random() * DEMO_SCENARIOS.length));
  const acted = random() < DEMO_ACT_PROBABILITY;
  const iteration = Math.floor(now / 1000);

  return {
    iteration,
    timestamp: now,
    promptHash: demoHash("prompt-trigger", iteration),
    oracleSnapshotHash: demoHash("oracle-trigger", iteration),
    recommendedAllocation: scenario.allocation,
    confidence: scenario.confidence,
    rationale: scenario.rationale,
    acted,
    txHash: acted ? `demo-reallocate-${now}` : null,
    skipReason: acted ? null : pickSkipReason(random),
  };
}

/**
 * Build a seeded list of demo decisions spread across the last ~30 minutes,
 * newest first — used by `/api/decisions` when demo mode is on and no real
 * log file exists yet. Deterministic given a fixed `now`, so the feed does
 * not visibly jitter between polls within the same request lifecycle.
 */
export function buildDemoDecisionFeed(
  now: number = Date.now(),
  count = 6
): DecisionLogEntry[] {
  const entries: DecisionLogEntry[] = [];

  for (let i = 0; i < count; i++) {
    const scenario = pickScenario(i);
    const minutesAgo = 2 + i * 5;
    const timestamp = now - minutesAgo * 60_000;
    const iteration = count - i;
    const acted = i % 2 === 0;
    const skipReason = DEMO_SKIP_REASONS[i % DEMO_SKIP_REASONS.length] ?? DEMO_SKIP_REASONS[0];

    entries.push({
      iteration,
      timestamp,
      promptHash: demoHash("prompt-seed", i),
      oracleSnapshotHash: demoHash("oracle-seed", i),
      recommendedAllocation: scenario.allocation,
      confidence: scenario.confidence,
      rationale: scenario.rationale,
      acted,
      txHash: acted ? `demo-reallocate-${timestamp}` : null,
      skipReason: acted ? null : skipReason,
    });
  }

  return entries;
}
