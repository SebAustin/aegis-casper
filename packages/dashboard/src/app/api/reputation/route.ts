import { NextResponse } from "next/server";

/**
 * GET /api/reputation
 *
 * Fetches the agent reputation from CSPR.cloud named-key read.
 * No signing required — FR-R-04 declares get_reputation as publicly readable.
 * BigInt fields are serialised as strings for JSON safety.
 */
export async function GET(): Promise<NextResponse> {
  const apiUrl = process.env["CSPR_CLOUD_API_URL"] ?? "";
  const apiKey = process.env["CSPR_CLOUD_API_KEY"] ?? "";
  const contractHash = process.env["REGISTRY_CONTRACT_HASH"] ?? "";
  const agentHash = process.env["AGENT_ACCOUNT_HASH"] ?? "";

  if (!contractHash || !apiUrl) {
    // Return a demo reputation so the gauge renders immediately.
    return NextResponse.json({
      agentAccountHash: agentHash,
      score: "750",
      totalDecisions: "42",
      correctPredictions: "38",
      registeredTs: Date.now() - 86_400_000,
    });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(
      `${apiUrl}/rpc/state/get-item?key=hash-${contractHash}&path=get_reputation&agent=${agentHash}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        next: { revalidate: 0 },
      }
    );
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`CSPR.cloud ${res.status}`);

    const raw: unknown = await res.json();
    const rep = parseReputation(raw, agentHash);

    return NextResponse.json(rep, { headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

function parseReputation(raw: unknown, agentHash: string): Record<string, unknown> {
  const asRecord = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const result = asRecord(asRecord(raw)["result"]);
  const storedValue = asRecord(result["stored_value"]);
  const clValue = asRecord(storedValue["CLValue"]);
  const parsed = clValue["parsed"];
  const r = asRecord(parsed !== undefined ? parsed : raw);
  return {
    agentAccountHash: agentHash,
    score: String(r["score"] ?? 0),
    totalDecisions: String(r["total_decisions"] ?? 0),
    correctPredictions: String(r["correct_predictions"] ?? 0),
    registeredTs: Number(r["registered_ts"] ?? 0),
  };
}
