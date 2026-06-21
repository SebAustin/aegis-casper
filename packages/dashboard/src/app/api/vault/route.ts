import { NextResponse } from "next/server";
import {
  defaultVaultAllocation,
  isRateLimitError,
  readVaultStateFromRpc,
} from "@aegis/shared";
import {
  getRouteCache,
  getSharedRpcClient,
  setRouteCache,
} from "@/lib/rpc-route-cache";

const CACHE_KEY = "vault";

/**
 * GET /api/vault
 *
 * Reads vault state from the Casper node RPC (authoritative purse balance).
 * Fast-fails on 429 and returns fallback within a few seconds.
 */
export async function GET(): Promise<NextResponse> {
  const nodeRpcUrl =
    process.env["CASPER_NODE_RPC_URL"] ?? "https://node.testnet.cspr.cloud/rpc";
  const apiKey = process.env["CSPR_CLOUD_API_KEY"] ?? "";
  const contractHash = process.env["VAULT_CONTRACT_HASH"] ?? "";
  const agentHash = process.env["AGENT_ACCOUNT_HASH"] ?? "";

  const fallbackBody = {
    totalBalanceMotes: "0",
    totalShares: "0",
    allocation: defaultVaultAllocation(),
    agentAccountHash: agentHash,
    paused: false,
    lastReallocationTs: 0,
  };

  if (!contractHash) {
    return NextResponse.json(fallbackBody, {
      status: 200,
      headers: { "Cache-Control": "no-store", "X-Data-Source": "fallback" },
    });
  }

  const cached = getRouteCache<typeof fallbackBody>(CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Source": "cache",
      },
    });
  }

  try {
    const rpc = await getSharedRpcClient(nodeRpcUrl, apiKey);
    const state = await readVaultStateFromRpc(rpc, contractHash, agentHash, {
      readPolicy: "fast-fail",
    });

    const body = {
      totalBalanceMotes: state.totalBalanceMotes.toString(),
      totalShares: state.totalShares.toString(),
      allocation: state.allocation,
      agentAccountHash: state.agentAccountHash,
      paused: state.paused,
      lastReallocationTs: state.lastReallocationTs,
    };
    setRouteCache(CACHE_KEY, body);

    return NextResponse.json(body, {
      status: 200,
      headers: { "Cache-Control": "no-store", "X-Data-Source": "casper-rpc" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const rateLimited = isRateLimitError(err);
    process.stderr.write(
      `[dashboard/api/vault] ${message} — returning fallback state\n`
    );
    return NextResponse.json(fallbackBody, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Source": "fallback",
        "X-Data-Warning": rateLimited ? "rate_limited" : message,
      },
    });
  }
}
