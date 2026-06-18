/**
 * Oracle SC-04 payment log test.
 *
 * Verifies that a successful paid call to GET /api/rwa-yields appends
 * exactly one entry to logs/payments.jsonl (SC-04, FR-O-05).
 *
 * Uses a temp directory so the test is hermetic and never pollutes the
 * repo-root log file. The `createApp` factory now accepts an optional
 * `paymentsLogPath` override for this purpose.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { v4 as uuidv4 } from "uuid";
import request from "supertest";
import { createApp } from "./app.js";
import { readJsonl } from "@aegis/shared";

// ── Env setup ─────────────────────────────────────────────────────────────────

// These must be set before createApp() calls loadEnv().
// Use a unique port to avoid conflicts with other test files.
// The existing oracle.test.ts already sets ORACLE_PAYEE_ACCOUNT_HASH="test-payee-hash"
// and ORACLE_PRICE_MOTES="1000000". These are compatible with our tests too.
process.env.ORACLE_PAYEE_ACCOUNT_HASH = "test-payee-hash-log";
process.env.ORACLE_PRICE_MOTES = "1000000";
process.env.ORACLE_PORT = "4098";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePayload(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const obj = {
    scheme: "x402-casper",
    network: "casper-testnet",
    amountMotes: "1000000",
    asset: "CSPR",
    recipient: "test-payee-hash-log",
    payer: "agent-account-hash",
    nonce: uuidv4(),
    expiryUnix: now + 300,
    signature: "deadbeef01234567",
    ...overrides,
  };
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Oracle payments.jsonl (SC-04, FR-O-05)", () => {
  let tmpDir: string;
  let paymentsLog: string;

  beforeEach(() => {
    tmpDir = path.join(
      tmpdir(),
      `aegis-oracle-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tmpDir, { recursive: true });
    paymentsLog = path.join(tmpDir, "payments.jsonl");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends exactly one entry to payments.jsonl on a successful paid call", async () => {
    // Create the app with our temp log path
    const app = createApp({ paymentsLogPath: paymentsLog });

    // File should not exist yet
    expect(existsSync(paymentsLog)).toBe(false);

    const payload = makePayload();
    const res = await request(app)
      .get("/api/rwa-yields")
      .set("x-payment-payload", payload);

    expect(res.status).toBe(200);
    expect(res.body.paymentReceipt).toBeDefined();

    // File must now exist and contain exactly one JSON line
    expect(existsSync(paymentsLog)).toBe(true);

    const entries = await readJsonl<{
      timestamp: number;
      iteration: number;
      receipt: { facilitator: string; paymentHash: string };
      callerAccountHash: string;
    }>(paymentsLog);

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(typeof entry.timestamp).toBe("number");
    expect(entry.timestamp).toBeGreaterThan(0);
    expect(entry.receipt.facilitator).toBe("mock");
    expect(typeof entry.receipt.paymentHash).toBe("string");
    expect(entry.receipt.paymentHash.length).toBeGreaterThan(0);
    expect(entry.callerAccountHash).toBe("agent-account-hash");
  });

  it("appends a new entry for each distinct successful paid call", async () => {
    const app = createApp({ paymentsLogPath: paymentsLog });

    // Two distinct successful payments
    const p1 = makePayload({ nonce: uuidv4() });
    const p2 = makePayload({ nonce: uuidv4() });

    const r1 = await request(app).get("/api/rwa-yields").set("x-payment-payload", p1);
    const r2 = await request(app).get("/api/rwa-yields").set("x-payment-payload", p2);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const entries = await readJsonl(paymentsLog);
    expect(entries).toHaveLength(2);
  });

  it("does NOT append to payments.jsonl when a payment is rejected (expired)", async () => {
    const app = createApp({ paymentsLogPath: paymentsLog });

    const now = Math.floor(Date.now() / 1000);
    const expiredPayload = makePayload({ expiryUnix: now - 60 });

    const res = await request(app)
      .get("/api/rwa-yields")
      .set("x-payment-payload", expiredPayload);

    expect(res.status).toBe(402);

    // Log file should still not exist (no successful payment logged)
    expect(existsSync(paymentsLog)).toBe(false);
  });

  it("does NOT append to payments.jsonl on a replayed nonce", async () => {
    const app = createApp({ paymentsLogPath: paymentsLog });

    const nonce = uuidv4();
    const payload = makePayload({ nonce });

    // First call succeeds and logs
    const first = await request(app)
      .get("/api/rwa-yields")
      .set("x-payment-payload", payload);
    expect(first.status).toBe(200);

    const entriesAfterFirst = await readJsonl(paymentsLog);
    expect(entriesAfterFirst).toHaveLength(1);

    // Replay is rejected — log must still have exactly 1 entry
    const replay = await request(app)
      .get("/api/rwa-yields")
      .set("x-payment-payload", payload);
    expect(replay.status).toBe(402);

    const entriesAfterReplay = await readJsonl(paymentsLog);
    expect(entriesAfterReplay).toHaveLength(1); // unchanged
  });
});
