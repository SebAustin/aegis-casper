import { NextResponse } from "next/server";

/**
 * GET /api/vault
 *
 * Fetches vault state from CSPR.cloud. Returns a VaultState JSON object.
 * The agent private key is NEVER referenced here — this is a read-only
 * named-key query that is publicly accessible without signing.
 */
export async function GET(): Promise<NextResponse> {
  const apiUrl = process.env["CSPR_CLOUD_API_URL"] ?? "";
  const apiKey = process.env["CSPR_CLOUD_API_KEY"] ?? "";
  const contractHash = process.env["VAULT_CONTRACT_HASH"] ?? "";

  // When no contract is deployed yet, return a graceful empty state so the
  // dashboard renders correctly (empty/loading path). This is expected during
  // development before testnet deploy.
  if (!contractHash || !apiUrl) {
    // BigInt values are serialised as strings over JSON (JSON.stringify does not
    // handle BigInt natively). The CockpitGrid client coerces them back to BigInt.
    return NextResponse.json(
      {
        totalBalanceMotes: "0",
        totalShares: "0",
        allocation: [
          { assetId: 0, bps: 2000 },
          { assetId: 1, bps: 2000 },
          { assetId: 2, bps: 2000 },
          { assetId: 3, bps: 2000 },
          { assetId: 4, bps: 2000 },
        ],
        agentAccountHash: process.env["AGENT_ACCOUNT_HASH"] ?? "",
        paused: false,
        lastReallocationTs: 0,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-Data-Source": "fallback",
        },
      }
    );
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(
      `${apiUrl}/rpc/state/get-item?key=hash-${contractHash}&path=get_state`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        next: { revalidate: 0 },
      }
    );
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`CSPR.cloud responded ${res.status}`);
    }

    // The raw on-chain response format varies by contract implementation.
    // We normalise it into the canonical VaultState shape.
    const raw: unknown = await res.json();
    const state = parseVaultState(raw);

    return NextResponse.json(state, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Vault data unavailable: ${message}` },
      { status: 503 }
    );
  }
}

/**
 * Parses the raw CSPR.cloud named-key response into a JSON-serializable shape.
 * BigInt fields are returned as strings for safe JSON serialisation.
 * The CockpitGrid client converts them back to BigInt.
 */
function parseVaultState(raw: unknown): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as Record<string, any>;
  const stored = r?.result?.stored_value?.CLValue?.parsed ?? r;

  return {
    totalBalanceMotes: String(stored?.total_balance_motes ?? 0),
    totalShares: String(stored?.total_shares ?? 0),
    allocation: Array.isArray(stored?.allocation) ? stored.allocation : [],
    agentAccountHash: stored?.agent_account_hash ?? "",
    paused: Boolean(stored?.paused),
    lastReallocationTs: Number(stored?.last_reallocation_ts ?? 0),
  };
}
