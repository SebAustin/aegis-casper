import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import {
  rwaOracleDataSchema,
  resolveRepoLogPath,
  type RwaOracleData,
} from "@aegis/shared";

/** JSON-safe oracle payload (BigInt motes → string). */
function serializeOracleForWire(data: RwaOracleData) {
  return {
    ...data,
    paymentReceipt: {
      ...data.paymentReceipt,
      amountMotes: data.paymentReceipt.amountMotes.toString(),
    },
  };
}

function resolveOracleUrl(): string {
  return (
    process.env["ORACLE_URL"] ??
    process.env["NEXT_PUBLIC_ORACLE_URL"] ??
    "http://127.0.0.1:4021"
  );
}

const DEMO_ASSETS = [
  { assetId: 0, name: "T-Bill", apyBps: 624, riskScore: 18, liquidityScore: 92, dataFreshnessMs: Date.now() },
  { assetId: 1, name: "Private Credit", apyBps: 910, riskScore: 54, liquidityScore: 61, dataFreshnessMs: Date.now() },
  { assetId: 2, name: "Commodities", apyBps: 780, riskScore: 42, liquidityScore: 74, dataFreshnessMs: Date.now() },
  { assetId: 3, name: "Liquid Staking", apyBps: 850, riskScore: 35, liquidityScore: 88, dataFreshnessMs: Date.now() },
  { assetId: 4, name: "Other", apyBps: 590, riskScore: 22, liquidityScore: 95, dataFreshnessMs: Date.now() },
] as const;

function demoOraclePayload() {
  const now = Math.floor(Date.now() / 1000);
  return {
    timestamp: Date.now(),
    oracleVersion: "1.0.0-demo",
    paymentReceipt: {
      paymentHash: "demo",
      facilitator: "mock" as const,
      amountMotes: "1000000",
      payerAccountHash: "",
      expiry: now + 3600,
      confirmedAt: now,
    },
    assets: DEMO_ASSETS.map((a) => ({ ...a, dataFreshnessMs: Date.now() })),
  };
}

/**
 * GET /api/oracle
 *
 * Returns the most recent oracle data snapshot. Two data sources are tried
 * in order:
 *   1. Live oracle via NEXT_PUBLIC_ORACLE_URL (the @aegis/oracle process)
 *   2. Last entry in logs/payments.jsonl (offline fallback)
 */
export async function GET(): Promise<NextResponse> {
  const oracleUrl = resolveOracleUrl();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    const res = await fetch(`${oracleUrl}/api/oracle/latest`, {
      signal: controller.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(timeoutId));

    if (res.ok) {
      const raw: unknown = await res.json();
      const result = rwaOracleDataSchema.safeParse(raw);
      if (result.success) {
        return NextResponse.json(serializeOracleForWire(result.data), {
          headers: {
            "Cache-Control": "no-store",
            "X-Data-Source": "live",
          },
        });
      }
      console.error(
        "[dashboard/api/oracle] Live oracle response failed schema validation:",
        result.error.issues.map((i) => i.message).join("; ")
      );
    } else {
      console.error(
        `[dashboard/api/oracle] Live oracle returned HTTP ${res.status}`
      );
    }
  } catch (err) {
    console.error(
      "[dashboard/api/oracle] Live oracle unreachable:",
      err instanceof Error ? err.message : String(err)
    );
  }

  const paymentsPath = resolveRepoLogPath("payments.jsonl");
  if (existsSync(paymentsPath)) {
    try {
      const text = readFileSync(paymentsPath, "utf8");
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1];
        if (lastLine) {
          const raw: unknown = JSON.parse(lastLine);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const receipt = (raw as Record<string, any>)?.receipt;
          if (receipt) {
            const merged = {
              ...demoOraclePayload(),
              paymentReceipt: receipt,
            };
            return NextResponse.json(merged, {
              headers: { "Cache-Control": "no-store", "X-Data-Source": "payments-log" },
            });
          }
        }
      }
    } catch {
      // Swallow parse error, return demo below.
    }
  }

  return NextResponse.json(demoOraclePayload(), {
    headers: { "Cache-Control": "no-store", "X-Data-Source": "demo" },
  });
}
