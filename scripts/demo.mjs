#!/usr/bin/env node
/**
 * scripts/demo.mjs — Aegis demo seed script (RISK-06 mitigation)
 *
 * Pre-warms the demo environment so that:
 *   1. The oracle has been called 3 times → logs/payments.jsonl has entries
 *      (SC-04: payment receipt attached to oracle call).
 *   2. logs/decisions.jsonl has 3 synthetic entries → decision feed is
 *      non-empty on first dashboard load (SC-05 pre-warm).
 *   3. The current yield spread is printed so the demo operator knows which
 *      reallocation direction to expect on the first live agent loop iteration.
 *
 * The script deliberately seeds asset APYs that differ from a flat equal-weight
 * allocation by more than the demo drift threshold (50 bps), so the agent's
 * first real loop iteration will fire a reallocation (RISK-06).
 *
 * Usage:
 *   node scripts/demo.mjs
 *
 * Environment:
 *   ORACLE_URL         — defaults to http://localhost:4021
 *   AGENT_ACCOUNT_HASH — defaults to demo-agent-account-hash-placeholder
 *
 * The oracle must be running before this script is called.
 */

import { writeFile, appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const ORACLE_URL = process.env.ORACLE_URL ?? "http://localhost:4021";
const AGENT_ACCOUNT_HASH =
  process.env.AGENT_ACCOUNT_HASH ?? "demo-agent-account-hash-placeholder";
const DECISIONS_LOG = path.join(repoRoot, "logs", "decisions.jsonl");
const PAYMENTS_LOG = path.join(repoRoot, "logs", "payments.jsonl");

// ── Logging ──────────────────────────────────────────────────────────────────

function log(msg, extra = {}) {
  process.stdout.write(
    JSON.stringify({ level: "info", service: "demo-seed", msg, ...extra }) + "\n"
  );
}

function warn(msg, extra = {}) {
  process.stdout.write(
    JSON.stringify({ level: "warn", service: "demo-seed", msg, ...extra }) + "\n"
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockPaymentPayload() {
  const nonce = randomUUID();
  const expiry = Math.floor(Date.now() / 1000) + 300; // 5 minutes
  const payload = {
    scheme: "x402",
    network: "casper-test",
    amount_motes: 1_000_000,
    asset: "CSPR",
    recipient: "oracle-payee-account-hash-placeholder",
    payer: AGENT_ACCOUNT_HASH,
    nonce,
    expiry_unix: expiry,
    signature: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

async function fetchOracleData(iteration) {
  const oracleEndpoint = `${ORACLE_URL}/api/rwa-yields`;

  // First request: expect 402
  log(`Oracle call ${iteration}: sending unauthenticated request`);
  let response = await fetch(oracleEndpoint);

  if (response.status !== 402) {
    warn(`Oracle returned ${response.status} instead of 402 — oracle may not be running`);
    return null;
  }

  const paymentRequired = response.headers.get("x-payment-required");
  log(`Oracle returned 402`, { paymentRequired });

  // Second request: send payment payload
  const payloadB64 = mockPaymentPayload();
  response = await fetch(oracleEndpoint, {
    headers: {
      "x-payment-payload": payloadB64,
    },
  });

  if (!response.ok) {
    warn(`Oracle payment rejected`, { status: response.status });
    return null;
  }

  const data = await response.json();
  log(`Oracle data received`, {
    iteration,
    paymentReceiptHash: data.payment_receipt?.receipt_hash ?? "mock",
    assetCount: data.assets?.length ?? 0,
  });

  return data;
}

function buildDecisionEntry(oracleData, iteration) {
  const now = new Date().toISOString();
  const assets = oracleData?.assets ?? syntheticAssets();

  // Demo allocation: weighted toward the highest-APY asset
  const sorted = [...assets].sort((a, b) => b.apy_bps - a.apy_bps);
  const allocation = buildDemoAllocation(sorted);

  const rationale = `Demo iteration ${iteration}: Tokenized Private Credit (${sorted[0].apy_bps} bps APY) shows highest risk-adjusted yield. Recommending ${allocation[0].weight_bps} bps concentration. Confidence reflects fresh oracle data.`;

  const oracleHash = createHash("sha256")
    .update(JSON.stringify(assets))
    .digest("hex");

  return {
    timestamp: now,
    iteration,
    phase: "decide",
    prompt_hash: createHash("sha256").update(rationale).digest("hex"),
    oracle_data_snapshot_hash: oracleHash,
    oracle_payment_receipt:
      oracleData?.payment_receipt?.receipt_hash ?? "mock-receipt-" + iteration,
    recommended_allocation: allocation,
    confidence: 72 + iteration * 3,
    rationale: rationale.slice(0, 500),
    current_allocation: [
      { asset_id: 0, weight_bps: 2000 },
      { asset_id: 1, weight_bps: 2000 },
      { asset_id: 2, weight_bps: 2000 },
      { asset_id: 3, weight_bps: 2000 },
      { asset_id: 4, weight_bps: 2000 },
    ],
    drift_bps: 350 + iteration * 50,
    action: "reallocate",
    tx_hash: null,
    duration_ms: 1200 + Math.round(Math.random() * 800),
  };
}

function buildDemoAllocation(sortedAssets) {
  // Weights: 3500 / 2500 / 1800 / 1200 / 1000 (sum = 10000)
  // Deliberately high concentration on top asset to ensure drift > 50 bps
  const weights = [3500, 2500, 1800, 1200, 1000];
  return sortedAssets.map((a, i) => ({
    asset_id: a.asset_id,
    weight_bps: weights[i],
  }));
}

function syntheticAssets() {
  // Fallback if oracle is not running
  return [
    { asset_id: 0, name: "Tokenized T-Bills", apy_bps: 510, risk_score: 10, liquidity_score: 90, data_freshness_ms: Date.now() },
    { asset_id: 1, name: "Tokenized Private Credit", apy_bps: 880, risk_score: 45, liquidity_score: 50, data_freshness_ms: Date.now() },
    { asset_id: 2, name: "Tokenized Commodities", apy_bps: 290, risk_score: 35, liquidity_score: 65, data_freshness_ms: Date.now() },
    { asset_id: 3, name: "Stable Yield", apy_bps: 470, risk_score: 8, liquidity_score: 95, data_freshness_ms: Date.now() },
    { asset_id: 4, name: "CSPR Liquid Staking", apy_bps: 650, risk_score: 25, liquidity_score: 80, data_freshness_ms: Date.now() },
  ];
}

function buildPaymentEntry(oracleData, iteration) {
  const now = new Date().toISOString();
  return {
    timestamp: now,
    iteration,
    receipt_hash:
      oracleData?.payment_receipt?.receipt_hash ??
      "mock-receipt-hash-" + createHash("sha256").update(now + iteration).digest("hex").slice(0, 32),
    payer: AGENT_ACCOUNT_HASH,
    amount_motes: 1_000_000,
    oracle_version: oracleData?.oracle_version ?? "0.1.0",
    facilitator: "mock",
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log("Aegis demo seed starting", {
    oracleUrl: ORACLE_URL,
    agentAccountHash: AGENT_ACCOUNT_HASH.slice(0, 20) + "...",
  });

  // Ensure logs directory exists
  await mkdir(path.join(repoRoot, "logs"), { recursive: true });

  // Clear existing demo logs (start fresh for the demo recording)
  await writeFile(DECISIONS_LOG, "");
  await writeFile(PAYMENTS_LOG, "");
  log("Cleared existing logs", { decisions: DECISIONS_LOG, payments: PAYMENTS_LOG });

  let oracleAvailable = true;

  // Call oracle 3 times and write both log files
  for (let i = 1; i <= 3; i++) {
    let oracleData = null;

    if (oracleAvailable) {
      try {
        oracleData = await fetchOracleData(i);
      } catch (err) {
        warn("Oracle not reachable — using synthetic data for seed", {
          error: err.message,
        });
        oracleAvailable = false;
      }
    }

    // Use synthetic data if oracle is not available
    if (!oracleData) {
      oracleData = {
        timestamp: new Date().toISOString(),
        oracle_version: "0.1.0",
        payment_receipt: {
          receipt_hash: "synthetic-receipt-" + createHash("sha256").update(String(i)).digest("hex").slice(0, 32),
          facilitator: "mock",
        },
        assets: syntheticAssets(),
      };
    }

    // Write payment log entry
    const paymentEntry = buildPaymentEntry(oracleData, i);
    await appendFile(PAYMENTS_LOG, JSON.stringify(paymentEntry) + "\n");

    // Write decision log entry
    const decisionEntry = buildDecisionEntry(oracleData, i);
    await appendFile(DECISIONS_LOG, JSON.stringify(decisionEntry) + "\n");

    log(`Seeded iteration ${i}`, {
      paymentReceipt: paymentEntry.receipt_hash.slice(0, 20) + "...",
      recommendedAllocation: decisionEntry.recommended_allocation,
      confidence: decisionEntry.confidence,
    });

    // Small delay between calls to avoid oracle nonce collision
    if (i < 3) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Print the yield spread for the demo operator
  const lastAssets = syntheticAssets().sort((a, b) => b.apy_bps - a.apy_bps);

  log("Demo seed complete", {
    decisionsWritten: 3,
    paymentsWritten: 3,
    oracleAvailable,
  });

  process.stdout.write("\n");
  process.stdout.write("=".repeat(60) + "\n");
  process.stdout.write("DEMO BRIEFING — read before recording\n");
  process.stdout.write("=".repeat(60) + "\n");
  process.stdout.write("\n");
  process.stdout.write("Current yield spread (highest to lowest APY):\n");
  lastAssets.forEach((a, i) => {
    process.stdout.write(
      `  ${i + 1}. ${a.name.padEnd(30)} ${(a.apy_bps / 100).toFixed(2)}% APY  risk=${a.risk_score}\n`
    );
  });
  process.stdout.write("\n");
  process.stdout.write("Expected first reallocation:\n");
  process.stdout.write("  The agent will concentrate ~35% in Tokenized Private Credit\n");
  process.stdout.write("  and ~25% in CSPR Liquid Staking, shifting from the flat 20/20/20/20/20\n");
  process.stdout.write("  initial allocation. Drift will be well above the 50 bps demo threshold.\n");
  process.stdout.write("\n");
  process.stdout.write("Start services in this order:\n");
  process.stdout.write("  1. pnpm oracle       # or: docker compose up oracle\n");
  process.stdout.write("  2. pnpm agent        # or: docker compose up agent\n");
  process.stdout.write("  3. pnpm dev          # or: docker compose up dashboard\n");
  process.stdout.write("  4. open http://localhost:3000\n");
  process.stdout.write("\n");
  process.stdout.write("Then follow the recording sequence in DEPLOYMENT.md §7.\n");
  process.stdout.write("=".repeat(60) + "\n");
}

main().catch((err) => {
  process.stderr.write(
    JSON.stringify({
      level: "error",
      service: "demo-seed",
      msg: "Demo seed failed",
      error: String(err?.stack ?? err),
    }) + "\n"
  );
  process.exit(1);
});
