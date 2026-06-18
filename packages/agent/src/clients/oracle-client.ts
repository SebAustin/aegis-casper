/**
 * OracleClient — constructs signed x402 payment payloads and fetches
 * RWA yield data from the oracle server (FR-A-02, A-017).
 *
 * Flow:
 *   1. GET /api/rwa-yields → 402 response (or 200 if already paid)
 *   2. Construct PaymentPayload, sign it with the agent keypair
 *   3. Base64-encode the payload, retry with X-PAYMENT-PAYLOAD header
 *   4. Return parsed RwaOracleData
 */

import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { rwaOracleDataSchema } from "@aegis/shared";
import type { RwaOracleData, PaymentPayload } from "@aegis/shared";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OracleClientConfig {
  oracleUrl: string;
  oraclePriceMotes: bigint;
  agentAccountHash: string;
  /** Sign data buffer; returns hex-encoded signature. */
  sign: (data: Buffer) => string;
}

// ── OracleClient ──────────────────────────────────────────────────────────────

export class OracleClient {
  constructor(private readonly config: OracleClientConfig) {}

  /**
   * Fetch RWA oracle data via the x402 paid flow.
   *
   * Steps:
   * 1. Initial unauthenticated GET → read 402 payment requirements
   * 2. Build & sign PaymentPayload
   * 3. Retry with X-PAYMENT-PAYLOAD header
   * 4. Zod-parse and return the response
   */
  async fetch(): Promise<RwaOracleData> {
    // Step 1: Get payment requirements
    const initialRes = await this.get("/api/rwa-yields");

    if (initialRes.status === 200) {
      // Already paid (shouldn't happen on first call but handle gracefully)
      return this.parseOracleResponse(await initialRes.json());
    }

    if (initialRes.status !== 402) {
      throw new Error(
        `OracleClient: unexpected status ${initialRes.status} on initial request`
      );
    }

    const requirementsJson = (await initialRes.json()) as {
      paymentRequired: {
        recipient: string;
        amount: string;
        expiry: number;
      };
    };

    const requirements = requirementsJson.paymentRequired;
    const now = Math.floor(Date.now() / 1000);
    const expiry = requirements.expiry ?? now + 300;

    // Step 2: Build and sign the payment payload (A-017)
    const payloadFields: Omit<PaymentPayload, "signature"> = {
      scheme: "x402-casper",
      network: "casper-testnet",
      amountMotes: this.config.oraclePriceMotes,
      asset: "CSPR",
      recipient: requirements.recipient,
      payer: this.config.agentAccountHash,
      nonce: uuidv4(),
      expiryUnix: expiry,
    };

    const canonicalDigest = computeCanonicalDigest(payloadFields);
    const signature = this.config.sign(canonicalDigest);

    const fullPayload: PaymentPayload = { ...payloadFields, signature };

    // Serialise — amountMotes must be a string in JSON (BigInt-safe)
    const payloadJson = JSON.stringify({
      ...fullPayload,
      amountMotes: fullPayload.amountMotes.toString(),
    });
    const encoded = Buffer.from(payloadJson).toString("base64");

    // Step 3: Retry with payment header
    const paidRes = await this.get("/api/rwa-yields", {
      "x-payment-payload": encoded,
    });

    if (!paidRes.ok) {
      const body = await paidRes.json().catch(() => ({}));
      throw new Error(
        `OracleClient: payment rejected (${paidRes.status}): ${JSON.stringify(body)}`
      );
    }

    // Step 4: Validate and return
    return this.parseOracleResponse(await paidRes.json());
  }

  // ── HTTP helpers ────────────────────────────────────────────────────────────

  private get(
    path: string,
    extraHeaders: Record<string, string> = {}
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    return fetch(`${this.config.oracleUrl}${path}`, {
      headers: { "Content-Type": "application/json", ...extraHeaders },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
  }

  private parseOracleResponse(raw: unknown): RwaOracleData {
    const result = rwaOracleDataSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(
        `OracleClient: response schema invalid — ${result.error.issues.map((i) => i.message).join(", ")}`
      );
    }
    return result.data;
  }
}

// ── Canonical digest (A-017) ──────────────────────────────────────────────────

/**
 * Compute the canonical SHA-256 digest of a payload (all fields except signature).
 * Keys are sorted alphabetically before serialisation.
 */
export function computeCanonicalDigest(
  fields: Omit<PaymentPayload, "signature">
): Buffer {
  const obj: Record<string, unknown> = {};
  for (const key of Object.keys(fields).sort()) {
    const v = fields[key as keyof typeof fields];
    obj[key] = typeof v === "bigint" ? v.toString() : v;
  }
  const json = JSON.stringify(obj);
  return createHash("sha256").update(json).digest();
}

// ── Mock signer (for offline tests) ──────────────────────────────────────────

/**
 * Returns a deterministic fake hex signature.
 * Only used in tests and MockLlmClient paths — never in production.
 */
export function mockSign(_data: Buffer): string {
  return "deadbeef0123456789abcdef0123456789abcdef0123456789abcdef01234567";
}
