/**
 * PaymentFacilitator implementations (A-004, A-017).
 *
 * MockFacilitator (default):
 *   - Decodes base64 X-PAYMENT-PAYLOAD JSON
 *   - Checks signature present + well-formed (non-empty hex)
 *   - Checks expiryUnix > now
 *   - Rejects seen nonces (in-memory seen-set) — replay protection
 *   - Returns synthetic PaymentReceipt
 *   NOTE: MockFacilitator does NOT cryptographically verify the
 *         signature against the payer key — that's CasperFacilitator.
 *         (PLAN.md RISK-12)
 *
 * CasperFacilitator (stub):
 *   - Delegates to a live x402 facilitator endpoint
 *   - Selected when X402_FACILITATOR=live
 */

import { createHash } from "node:crypto";
import { paymentPayloadSchema } from "@aegis/shared";
import type { PaymentFacilitator, PaymentReceipt } from "@aegis/shared";

// ── MockFacilitator ───────────────────────────────────────────────────────────

export class MockFacilitator implements PaymentFacilitator {
  private readonly seenNonces = new Set<string>();

  /**
   * Verify a base64-encoded X-PAYMENT-PAYLOAD header value.
   *
   * @param encodedPayload  Raw value of the X-PAYMENT-PAYLOAD header (base64 JSON).
   * @param now             Current UNIX timestamp in seconds (injectable for tests).
   * @throws {Error} on expiry, replay, or malformed payload.
   */
  async verify(encodedPayload: string, now: number): Promise<PaymentReceipt> {
    // 1. Decode base64 → parse JSON
    let rawJson: string;
    try {
      rawJson = Buffer.from(encodedPayload, "base64").toString("utf8");
    } catch {
      throw new Error("x402: payload is not valid base64");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error("x402: payload JSON is malformed");
    }

    // 2. Zod validation
    const result = paymentPayloadSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `x402: payload schema invalid — ${result.error.issues.map((i) => i.message).join(", ")}`
      );
    }

    const payload = result.data;

    // 3. Check expiry (NFR-S-04)
    if (payload.expiryUnix <= now) {
      throw new Error(
        `x402: payment payload expired (expiryUnix=${payload.expiryUnix}, now=${now})`
      );
    }

    // 4. Replay protection — reject seen nonces
    if (this.seenNonces.has(payload.nonce)) {
      throw new Error(`x402: replayed nonce ${payload.nonce}`);
    }
    this.seenNonces.add(payload.nonce);

    // 5. Signature present and well-formed (non-empty hex string)
    //    MockFacilitator does NOT do cryptographic verification (RISK-12).
    if (!payload.signature || !/^[0-9a-fA-F]+$/.test(payload.signature)) {
      throw new Error("x402: signature is missing or not valid hex");
    }

    // 6. Compute synthetic payment hash = SHA-256 of the canonical JSON (minus signature)
    const paymentHash = computePaymentHash(payload);

    return {
      paymentHash,
      facilitator: "mock",
      amountMotes: payload.amountMotes,
      payerAccountHash: payload.payer,
      expiry: payload.expiryUnix,
      confirmedAt: now,
    };
  }
}

// ── CasperFacilitator (stub) ──────────────────────────────────────────────────

export class CasperFacilitator implements PaymentFacilitator {
  constructor(private readonly facilitatorUrl: string) {}

  /**
   * Delegates to a live x402 Casper facilitator endpoint.
   * Stub implementation — connect to real endpoint when OQ-01 is resolved.
   */
  async verify(encodedPayload: string, now: number): Promise<PaymentReceipt> {
    const response = await fetch(`${this.facilitatorUrl}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: encodedPayload, now }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `x402: CasperFacilitator responded ${response.status}: ${text}`
      );
    }

    const data = (await response.json()) as PaymentReceipt;
    return data;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create the appropriate facilitator based on environment config.
 */
export function createFacilitator(
  mode: "mock" | "live",
  facilitatorUrl?: string
): PaymentFacilitator {
  if (mode === "live") {
    if (!facilitatorUrl) {
      throw new Error(
        "X402_FACILITATOR=live but X402_FACILITATOR_URL is not set"
      );
    }
    return new CasperFacilitator(facilitatorUrl);
  }
  return new MockFacilitator();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type PayloadWithoutSignature = {
  scheme: string;
  network: string;
  amountMotes: bigint;
  asset: string;
  recipient: string;
  payer: string;
  nonce: string;
  expiryUnix: number;
};

/**
 * Compute the canonical payment hash (SHA-256 of the payload sans signature).
 * Keys are sorted alphabetically before serialisation (A-017).
 */
export function computePaymentHash(payload: PayloadWithoutSignature): string {
  const canonical: Record<string, unknown> = {};
  const keys: (keyof PayloadWithoutSignature)[] = [
    "amountMotes",
    "asset",
    "expiryUnix",
    "network",
    "nonce",
    "payer",
    "recipient",
    "scheme",
  ];

  // Sorted key order (A-017)
  for (const k of keys.sort()) {
    const v = payload[k as keyof PayloadWithoutSignature];
    canonical[k] = typeof v === "bigint" ? v.toString() : v;
  }

  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}
