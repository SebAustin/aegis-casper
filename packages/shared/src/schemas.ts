/**
 * Zod validation schemas for every external-boundary type.
 * Used as the validation gate for LLM output, oracle responses,
 * MCP tool arguments, and CSPR.cloud API responses.
 */

import { z } from "zod";

// ── Primitive aliases ────────────────────────────────────────────────────────

/** Basis points: integer in [0, 10_000]. */
const basisPointsSchema = z
  .number()
  .int()
  .min(0)
  .max(10_000, "Basis points must be ≤ 10,000");

/** Asset ID: integer in [0, 4] (5 RWA slots). */
const assetIdSchema = z
  .number()
  .int()
  .min(0)
  .max(4, "AssetId must be 0..4");

// ── AllocationMap ─────────────────────────────────────────────────────────────

export const allocationEntrySchema = z.object({
  assetId: assetIdSchema,
  bps: basisPointsSchema,
});

export const allocationMapSchema = z
  .array(allocationEntrySchema)
  .length(5, "AllocationMap must have exactly 5 entries");

// ── LLM output ───────────────────────────────────────────────────────────────

/**
 * Schema for the JSON that the LLM must return.
 * Validated via Zod before any allocation is accepted (NFR-S-06).
 */
export const llmDecisionSchema = z.object({
  allocation: allocationMapSchema,
  confidence: z
    .number()
    .min(0, "Confidence must be ≥ 0")
    .max(100, "Confidence must be ≤ 100"),
  rationale: z
    .string()
    .max(500, "Rationale must be ≤ 500 characters")
    .min(1, "Rationale must be non-empty"),
});

// ── RwaAsset / RwaOracleData ──────────────────────────────────────────────────

export const rwaAssetSchema = z.object({
  assetId: assetIdSchema,
  name: z.string().min(1),
  apyBps: z.number().int().min(0),
  riskScore: z.number().min(0).max(100),
  liquidityScore: z.number().min(0).max(100),
  dataFreshnessMs: z.number().int().nonnegative(),
});

export const paymentReceiptSchema = z.object({
  paymentHash: z.string().min(1),
  facilitator: z.enum(["mock", "casper"]),
  amountMotes: z.union([z.bigint(), z.string().transform(BigInt)]),
  payerAccountHash: z.string().min(1),
  expiry: z.number().int(),
  confirmedAt: z.number().int(),
});

export const rwaOracleDataSchema = z.object({
  timestamp: z.number().int().positive(),
  oracleVersion: z.string().min(1),
  paymentReceipt: paymentReceiptSchema,
  assets: z
    .array(rwaAssetSchema)
    .length(5, "Oracle response must contain exactly 5 assets"),
});

// ── PaymentPayload ────────────────────────────────────────────────────────────

/**
 * Schema for the base64-decoded X-PAYMENT-PAYLOAD JSON (A-017).
 * amountMotes is serialised as a string in JSON (BigInt-safe).
 */
export const paymentPayloadSchema = z.object({
  scheme: z.string().min(1),
  network: z.string().min(1),
  amountMotes: z.union([
    z.bigint(),
    z.string().transform((v) => BigInt(v)),
    z.number().transform((v) => BigInt(v)),
  ]),
  asset: z.string().min(1),
  recipient: z.string().min(1),
  payer: z.string().min(1),
  nonce: z.string().uuid("Nonce must be a UUID v4"),
  expiryUnix: z.number().int().positive("Expiry must be a positive UNIX timestamp"),
  signature: z.string().min(1, { message: "payload signature is required" }),
});

// ── DecisionLogEntry ──────────────────────────────────────────────────────────

export const decisionLogEntrySchema = z.object({
  iteration: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
  promptHash: z.string().min(1),
  oracleSnapshotHash: z.string().min(1),
  recommendedAllocation: allocationMapSchema,
  confidence: z.number().min(0).max(100),
  rationale: z.string().max(500),
  acted: z.boolean(),
  txHash: z.string().nullable(),
  skipReason: z.string().nullable(),
});

// ── PaymentLog entry (what goes into payments.jsonl) ─────────────────────────

export const paymentLogEntrySchema = z.object({
  timestamp: z.number().int().positive(),
  iteration: z.number().int().nonnegative(),
  receipt: paymentReceiptSchema,
  callerAccountHash: z.string().min(1),
});
