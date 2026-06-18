import { describe, it, expect, beforeEach } from "vitest";
import { MockFacilitator } from "./facilitator.js";
import type { MockFacilitatorConfig } from "./facilitator.js";
import { v4 as uuidv4 } from "uuid";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePayload(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const obj = {
    scheme: "x402-casper",
    network: "casper-testnet",
    amountMotes: "1000000",
    asset: "CSPR",
    // Must match the ORACLE_PAYEE_ACCOUNT_HASH env var set below so that
    // MockFacilitator's recipient check passes.
    recipient: "test-payee-hash",
    payer: "agent-account-hash",
    nonce: uuidv4(),
    expiryUnix: now + 300,
    signature: "deadbeef01234567",
    ...overrides,
  };
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

// ── MockFacilitator tests ─────────────────────────────────────────────────────

describe("MockFacilitator", () => {
  let facilitator: MockFacilitator;
  const NOW = Math.floor(Date.now() / 1000);

  beforeEach(() => {
    facilitator = new MockFacilitator();
  });

  it("verifies a well-formed payload and returns a receipt", async () => {
    const payload = makePayload();
    const receipt = await facilitator.verify(payload, NOW);

    expect(receipt.facilitator).toBe("mock");
    expect(typeof receipt.paymentHash).toBe("string");
    expect(receipt.paymentHash.length).toBeGreaterThan(0);
    expect(receipt.payerAccountHash).toBe("agent-account-hash");
    expect(receipt.amountMotes).toBe(BigInt(1_000_000));
  });

  it("rejects an expired payload (expiryUnix <= now)", async () => {
    const expired = makePayload({ expiryUnix: NOW - 1 });
    await expect(facilitator.verify(expired, NOW)).rejects.toThrow(/expired/);
  });

  it("rejects a replayed nonce", async () => {
    const nonce = uuidv4();
    const payload = makePayload({ nonce });

    // First call succeeds
    await facilitator.verify(payload, NOW);

    // Second call with same nonce is rejected
    const replay = makePayload({ nonce });
    await expect(facilitator.verify(replay, NOW)).rejects.toThrow(/replayed nonce/);
  });

  it("rejects a missing signature", async () => {
    const payload = makePayload({ signature: "" });
    await expect(facilitator.verify(payload, NOW)).rejects.toThrow(/signature/);
  });

  it("rejects a non-hex signature", async () => {
    const payload = makePayload({ signature: "not-hex!" });
    await expect(facilitator.verify(payload, NOW)).rejects.toThrow(/signature/);
  });

  it("rejects invalid base64", async () => {
    await expect(facilitator.verify("!!!not-base64!!!", NOW)).rejects.toThrow();
  });

  it("rejects malformed JSON inside base64", async () => {
    const bad = Buffer.from("{not json}").toString("base64");
    await expect(facilitator.verify(bad, NOW)).rejects.toThrow(/malformed/);
  });

  it("rejects payload missing required fields", async () => {
    const obj = { scheme: "x402-casper" }; // missing most fields
    const payload = Buffer.from(JSON.stringify(obj)).toString("base64");
    await expect(facilitator.verify(payload, NOW)).rejects.toThrow(/schema invalid/);
  });

  it("accepts a payload expiring exactly 1 second in the future", async () => {
    const payload = makePayload({ expiryUnix: NOW + 1 });
    const receipt = await facilitator.verify(payload, NOW);
    expect(receipt.expiry).toBe(NOW + 1);
  });
});

// ── SEC-03 gating tests ───────────────────────────────────────────────────────
//
// Validates the recipient-match and amount-floor checks added to close the
// "anyone can forge an accepted payment without matching recipient/amount" gap
// identified in SEC-03 of SECURITY.md.

const SEC03_CONFIG: MockFacilitatorConfig = {
  expectedRecipient: "oracle-payee-hash",
  minAmountMotes: BigInt(1_000_000),
};

function makeSec03Payload(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const obj = {
    scheme: "x402-casper",
    network: "casper-testnet",
    amountMotes: "1000000",
    asset: "CSPR",
    recipient: "oracle-payee-hash",
    payer: "agent-account-hash",
    nonce: uuidv4(),
    expiryUnix: now + 300,
    signature: "deadbeef01234567",
    ...overrides,
  };
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

describe("MockFacilitator — SEC-03 recipient and amount gating", () => {
  const NOW = Math.floor(Date.now() / 1000);

  it("accepts a payload with correct recipient and sufficient amount", async () => {
    const f = new MockFacilitator(SEC03_CONFIG);
    const payload = makeSec03Payload();
    const receipt = await f.verify(payload, NOW);
    expect(receipt.facilitator).toBe("mock");
    expect(receipt.amountMotes).toBe(BigInt(1_000_000));
  });

  it("rejects a payload whose recipient does not match the expected payee (SEC-03)", async () => {
    const f = new MockFacilitator(SEC03_CONFIG);
    const payload = makeSec03Payload({ recipient: "wrong-recipient-hash" });
    await expect(f.verify(payload, NOW)).rejects.toThrow(/recipient mismatch/);
  });

  it("rejects a payload whose amountMotes is below the minimum price (SEC-03)", async () => {
    const f = new MockFacilitator(SEC03_CONFIG);
    // Send 1 mote less than the required minimum
    const payload = makeSec03Payload({ amountMotes: "999999" });
    await expect(f.verify(payload, NOW)).rejects.toThrow(/amount too low/);
  });

  it("accepts a payload whose amountMotes exactly equals the minimum price", async () => {
    const f = new MockFacilitator(SEC03_CONFIG);
    const payload = makeSec03Payload({ amountMotes: "1000000" });
    const receipt = await f.verify(payload, NOW);
    expect(receipt.amountMotes).toBe(BigInt(1_000_000));
  });

  it("accepts a payload whose amountMotes exceeds the minimum price", async () => {
    const f = new MockFacilitator(SEC03_CONFIG);
    const payload = makeSec03Payload({ amountMotes: "5000000" });
    const receipt = await f.verify(payload, NOW);
    expect(receipt.amountMotes).toBe(BigInt(5_000_000));
  });
});

// ── HTTP integration tests ────────────────────────────────────────────────────

import { createApp } from "./app.js";
import request from "supertest";

// Override ORACLE_PAYEE_ACCOUNT_HASH for test isolation
process.env.ORACLE_PAYEE_ACCOUNT_HASH = "test-payee-hash";
process.env.ORACLE_PRICE_MOTES = "1000000";
process.env.ORACLE_PORT = "4099";

describe("Oracle HTTP API", () => {
  const app = createApp();

  it("GET /api/health returns { status: 'ok' }", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.uptime_ms).toBe("number");
  });

  it("GET /api/rwa-yields without payment returns 402", async () => {
    const res = await request(app).get("/api/rwa-yields");
    expect(res.status).toBe(402);
    expect(res.body.paymentRequired).toBeDefined();
    expect(res.body.paymentRequired.amount).toBe("1000000");
    expect(res.body.paymentRequired.asset).toBe("CSPR");
  });

  it("GET /api/rwa-yields with valid payment returns 200 + 5 assets", async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = makePayload({ expiryUnix: now + 300 });

    const res = await request(app)
      .get("/api/rwa-yields")
      .set("x-payment-payload", payload);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.assets)).toBe(true);
    expect(res.body.assets).toHaveLength(5);
    expect(res.body.paymentReceipt).toBeDefined();
    expect(res.body.paymentReceipt.facilitator).toBe("mock");
  });

  it("GET /api/rwa-yields with replayed nonce returns 402", async () => {
    const now = Math.floor(Date.now() / 1000);
    const nonce = uuidv4();
    const payload = makePayload({ nonce, expiryUnix: now + 300 });

    // First call succeeds
    const first = await request(app)
      .get("/api/rwa-yields")
      .set("x-payment-payload", payload);
    expect(first.status).toBe(200);

    // Replay is rejected
    const replay = await request(app)
      .get("/api/rwa-yields")
      .set("x-payment-payload", payload);
    expect(replay.status).toBe(402);
    expect(replay.body.reason).toMatch(/replay/i);
  });

  it("GET /api/rwa-yields with expired payload returns 402", async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = makePayload({ expiryUnix: now - 10 });

    const res = await request(app)
      .get("/api/rwa-yields")
      .set("x-payment-payload", payload);

    expect(res.status).toBe(402);
    expect(res.body.reason).toMatch(/expired/);
  });
});
