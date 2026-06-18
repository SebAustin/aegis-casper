/**
 * Express application for the Aegis x402-gated oracle API.
 *
 * Routes:
 *   GET /api/health  — public health check (FR-O-06)
 *   GET /api/rwa-yields — x402-gated yield data (FR-O-01..05)
 *
 * The app is exported separately from the server entry point so
 * it can be imported in tests without binding a port.
 */

import express, { type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendJsonl, loadEnv } from "@aegis/shared";
import { createFacilitator } from "./facilitator.js";
import { generateAssets } from "./seed-data.js";

const startedAt = Date.now();

export interface CreateAppOptions {
  /** Override the payments log path (default: repo-root logs/payments.jsonl). */
  paymentsLogPath?: string;
}

export function createApp(options: CreateAppOptions = {}): express.Application {
  const env = loadEnv();
  const app = express();

  // Serialize BigInt mote amounts as strings on the wire (canonical for
  // Casper amounts) — Express's default JSON.stringify cannot serialize BigInt.
  app.set("json replacer", (_key: string, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value
  );

  const facilitator = createFacilitator(
    env.X402_FACILITATOR,
    env.X402_FACILITATOR_URL,
    {
      expectedRecipient: env.ORACLE_PAYEE_ACCOUNT_HASH,
      minAmountMotes: env.ORACLE_PRICE_MOTES,
    }
  );

  // Resolve the repo-root logs directory relative to this file
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const PAYMENTS_LOG =
    options.paymentsLogPath ??
    path.resolve(__dirname, "../../../logs/payments.jsonl");

  // ── Health (public, no payment required) ──────────────────────────────────

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      version: "1.0.0",
      uptime_ms: Date.now() - startedAt,
    });
  });

  // ── RWA Yields (x402-gated) ───────────────────────────────────────────────

  app.get("/api/rwa-yields", async (req: Request, res: Response) => {
    const paymentHeader = req.headers["x-payment-payload"] as string | undefined;

    // Step 1: No payment header → return 402 + payment requirements (FR-O-01)
    if (!paymentHeader) {
      const now = Math.floor(Date.now() / 1000);
      const expiry = now + 300; // 5-minute window

      // Set the machine-readable header BEFORE sending the body (FR-O-01).
      res.setHeader(
        "X-PAYMENT-REQUIRED",
        JSON.stringify({
          amount: env.ORACLE_PRICE_MOTES.toString(),
          asset: "CSPR",
          recipient: env.ORACLE_PAYEE_ACCOUNT_HASH,
          expiry,
        })
      );
      res.status(402).json({
        error: "Payment required",
        paymentRequired: {
          amount: env.ORACLE_PRICE_MOTES.toString(),
          asset: "CSPR",
          recipient: env.ORACLE_PAYEE_ACCOUNT_HASH,
          expiry,
          scheme: "x402-casper",
          network: env.CASPER_NETWORK,
        },
      });
      return;
    }

    // Step 2: Payment header present → verify via facilitator (FR-O-02)
    const now = Math.floor(Date.now() / 1000);
    let receipt;

    try {
      receipt = await facilitator.verify(paymentHeader, now);
    } catch (err) {
      res.status(402).json({
        error: "Payment verification failed",
        reason: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // Step 3: Log the payment to payments.jsonl (FR-O-05, SC-04)
    await appendJsonl(PAYMENTS_LOG, {
      timestamp: Date.now(),
      iteration: 0, // oracle doesn't track iteration; agent stamps this
      receipt,
      callerAccountHash: receipt.payerAccountHash,
    });

    // Step 4: Return yield data + receipt (FR-O-04)
    const assets = generateAssets(true);
    res.json({
      timestamp: Date.now(),
      oracleVersion: "1.0.0",
      paymentReceipt: receipt,
      assets,
    });
  });

  return app;
}
