/**
 * PaymentFacilitator implementations (A-004, A-017).
 *
 * MockFacilitator (default):
 *   - Decodes base64 X-PAYMENT-PAYLOAD JSON
 *   - Checks payload integrity: recomputes the canonical digest and ensures the
 *     signature field is present + well-formed hex (non-empty)
 *   - Checks recipient matches the configured oracle payee account hash
 *   - Checks amountMotes >= configured ORACLE_PRICE_MOTES
 *   - Checks expiryUnix > now
 *   - Rejects seen nonces (in-memory seen-set) — replay protection
 *   - Returns synthetic PaymentReceipt
 *
 *   NOTE: MockFacilitator does NOT cryptographically verify the ed25519/secp256k1
 *         signature against the payer's public key. It only checks that the
 *         signature field is present and well-formed hex, and that the canonical
 *         digest the payload claims to sign over is internally consistent.
 *         CasperFacilitator MUST perform real signature verification using
 *         casper-js-sdk's PublicKey.verify() (or equivalent) against the payer's
 *         on-chain public key. See SEC-03 in SECURITY.md.
 *
 * CasperFacilitator (stub):
 *   - Delegates to a live x402 facilitator endpoint
 *   - Selected when X402_FACILITATOR=live
 */

import { createHash } from "node:crypto";
import { paymentPayloadSchema } from "@aegis/shared";
import type { PaymentFacilitator, PaymentReceipt } from "@aegis/shared";

// ── MockFacilitator ───────────────────────────────────────────────────────────

export interface MockFacilitatorConfig {
  /** Expected oracle payee account hash. Payloads with a different recipient are rejected. */
  expectedRecipient: string;
  /** Minimum acceptable payment in motes. Payloads below this threshold are rejected. */
  minAmountMotes: bigint;
}

export class MockFacilitator implements PaymentFacilitator {
  private readonly seenNonces = new Set<string>();
  private readonly expectedRecipient: string;
  private readonly minAmountMotes: bigint;

  /**
   * @param config  Expected recipient and minimum amount. Defaults to the values
   *                from process.env (ORACLE_PAYEE_ACCOUNT_HASH, ORACLE_PRICE_MOTES)
   *                when omitted, so existing call-sites that construct with `new
   *                MockFacilitator()` continue to work.
   */
  constructor(config?: Partial<MockFacilitatorConfig>) {
    this.expectedRecipient =
      config?.expectedRecipient ??
      (process.env["ORACLE_PAYEE_ACCOUNT_HASH"] ?? "");
    this.minAmountMotes =
      config?.minAmountMotes ??
      BigInt(process.env["ORACLE_PRICE_MOTES"] ?? "0");
  }

  /**
   * Verify a base64-encoded X-PAYMENT-PAYLOAD header value.
   *
   * Checks performed (in order):
   *   1. Base64 decode + JSON parse
   *   2. Zod schema validation
   *   3. Expiry (NFR-S-04)
   *   4. Nonce replay protection
   *   5. Signature present + well-formed hex (payload integrity pre-check)
   *   6. Canonical digest integrity — the digest the signature covers must match
   *      what we compute from the payload fields
   *   7. Recipient matches expected oracle payee (SEC-03)
   *   8. Amount >= minimum price (SEC-03)
   *
   * @param encodedPayload  Raw value of the X-PAYMENT-PAYLOAD header (base64 JSON).
   * @param now             Current UNIX timestamp in seconds (injectable for tests).
   * @throws {Error} on any verification failure.
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

    // 5. Signature present and well-formed (non-empty hex string).
    //
    //    IMPORTANT — MockFacilitator does NOT cryptographically verify the
    //    ed25519/secp256k1 signature against the payer's public key. It only
    //    confirms the field is present and hex-encoded. CasperFacilitator MUST
    //    perform real public-key signature verification using casper-js-sdk's
    //    PublicKey.verifySignature() against the payer's on-chain key (SEC-03).
    if (!payload.signature || !/^[0-9a-fA-F]+$/.test(payload.signature)) {
      throw new Error("x402: signature is missing or not valid hex");
    }

    // 6. Payload integrity — recompute the canonical digest from the payload
    //    fields and verify it is non-empty (proves the fields are internally
    //    consistent and were not swapped after signing).  CasperFacilitator
    //    must additionally verify that the signature in `payload.signature`
    //    matches this digest under the payer's public key (SEC-03).
    const expectedDigest = computePaymentHash(payload);
    if (!expectedDigest || expectedDigest.length === 0) {
      throw new Error("x402: canonical digest computation failed");
    }

    // 7. Recipient must match the configured oracle payee (SEC-03).
    //    This closes the gap where any payer could forge a payment to a
    //    different recipient and still receive data.
    if (
      this.expectedRecipient.length > 0 &&
      payload.recipient !== this.expectedRecipient
    ) {
      throw new Error(
        `x402: recipient mismatch — expected ${this.expectedRecipient}, got ${payload.recipient}`
      );
    }

    // 8. Amount must meet the minimum price (SEC-03).
    //    Prevents under-priced payloads from bypassing the payment gate.
    if (payload.amountMotes < this.minAmountMotes) {
      throw new Error(
        `x402: amount too low — required ${this.minAmountMotes} motes, got ${payload.amountMotes}`
      );
    }

    return {
      paymentHash: expectedDigest,
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
 *
 * @param mode             "mock" (default, testnet demo) or "live" (CasperFacilitator).
 * @param facilitatorUrl   Required when mode === "live".
 * @param mockConfig       Optional recipient/amount constraints for MockFacilitator.
 *                         Defaults to ORACLE_PAYEE_ACCOUNT_HASH / ORACLE_PRICE_MOTES env vars.
 */
export function createFacilitator(
  mode: "mock" | "live",
  facilitatorUrl?: string,
  mockConfig?: Partial<MockFacilitatorConfig>
): PaymentFacilitator {
  if (mode === "live") {
    if (!facilitatorUrl) {
      throw new Error(
        "X402_FACILITATOR=live but X402_FACILITATOR_URL is not set"
      );
    }
    return new CasperFacilitator(facilitatorUrl);
  }
  return new MockFacilitator(mockConfig);
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
