import { describe, it, expect, beforeEach } from "vitest";
import { MockFacilitator } from "./facilitator.js";
import { v4 as uuidv4 } from "uuid";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePayload(overrides: Record<string, unknown> = {}): string {
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
