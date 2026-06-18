import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { rwaOracleDataSchema } from "@aegis/shared";

/**
 * GET /api/oracle
 *
 * Returns the most recent oracle data snapshot. Two data sources are tried
 * in order:
 *   1. Live oracle via NEXT_PUBLIC_ORACLE_URL (the @aegis/oracle process)
 *   2. Last entry in logs/payments.jsonl (offline fallback)
 */
export async function GET(): Promise<NextResponse> {
  const oracleUrl = process.env["NEXT_PUBLIC_ORACLE_URL"] ?? "http://localhost:4021";

  // Try the live oracle health check first to see if it is reachable.
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5_000);

    // Fetch the last known oracle data from a dedicated endpoint.
    const res = await fetch(`${oracleUrl}/api/oracle/latest`, {
      signal: controller.signal,
      next: { revalidate: 0 },
    });

    if (res.ok) {
      const raw: unknown = await res.json();
      const result = rwaOracleDataSchema.safeParse(raw);
      if (result.success) {
        return NextResponse.json(result.data, {
          headers: { "Cache-Control": "no-store" },
        });
      }
    }
  } catch {
    // Oracle unreachable — fall through to log file.
  }

  // Fallback: read most recent entry from payments.jsonl.
  const paymentsPath = resolve(process.cwd(), "../../logs/payments.jsonl");
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
            return NextResponse.json(
              { paymentReceipt: receipt, fromLog: true },
              { headers: { "Cache-Control": "no-store" } }
            );
          }
        }
      }
    } catch {
      // Swallow parse error, return null below.
    }
  }

  // No data available — return a demo payload so the panel renders.
  // amountMotes is serialised as a string for JSON safety (BigInt workaround).
  const demoData = {
    timestamp: Date.now(),
    oracleVersion: "1.0.0-demo",
    paymentReceipt: {
      paymentHash: "",
      facilitator: "mock",
      amountMotes: "1000000",
      payerAccountHash: "",
      expiry: Math.floor(Date.now() / 1000) + 3600,
      confirmedAt: Math.floor(Date.now() / 1000),
    },
    assets: [
      { assetId: 0, name: "T-Bill",         apyBps: 624,  riskScore: 18, liquidityScore: 92, dataFreshnessMs: Date.now() },
      { assetId: 1, name: "Private Credit", apyBps: 910,  riskScore: 54, liquidityScore: 61, dataFreshnessMs: Date.now() },
      { assetId: 2, name: "Commodities",    apyBps: 780,  riskScore: 42, liquidityScore: 74, dataFreshnessMs: Date.now() },
      { assetId: 3, name: "Liquid Staking", apyBps: 850,  riskScore: 35, liquidityScore: 88, dataFreshnessMs: Date.now() },
      { assetId: 4, name: "Other",          apyBps: 590,  riskScore: 22, liquidityScore: 95, dataFreshnessMs: Date.now() },
    ],
  };

  return NextResponse.json(demoData, { headers: { "Cache-Control": "no-store" } });
}
