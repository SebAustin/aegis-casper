import { NextResponse } from "next/server";
import {
  isRateLimitError,
  readReputationFromRpc,
} from "@aegis/shared";
import {
  getRouteCache,
  getSharedRpcClient,
  setRouteCache,
} from "@/lib/rpc-route-cache";

const CACHE_KEY = "reputation";

/**
 * GET /api/reputation
 *
 * Reads agent reputation from the Odra registry via node RPC (authoritative).
 * Fast-fails on 429 and falls back to REPUTATION_SEED_SCORE.
 */
export async function GET(): Promise<NextResponse> {
  const nodeRpcUrl =
    process.env["CASPER_NODE_RPC_URL"] ?? "https://node.testnet.cspr.cloud/rpc";
  const apiKey = process.env["CSPR_CLOUD_API_KEY"] ?? "";
  const contractHash = process.env["REGISTRY_CONTRACT_HASH"] ?? "";
  const agentHash = process.env["AGENT_ACCOUNT_HASH"] ?? "";
  const seedScore = BigInt(process.env["REPUTATION_SEED_SCORE"] ?? "50");

  const fallbackBody = {
    agentAccountHash: agentHash,
    score: String(seedScore),
    totalDecisions: "0",
    correctPredictions: "0",
    registeredTs: Date.now() - 86_400_000,
  };

  if (!contractHash || !agentHash) {
    return NextResponse.json(fallbackBody, {
      headers: { "X-Data-Source": "fallback" },
    });
  }

  const cached = getRouteCache<typeof fallbackBody>(CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "no-store", "X-Data-Source": "cache" },
    });
  }

  try {
    const rpc = await getSharedRpcClient(nodeRpcUrl, apiKey);
    const rep = await readReputationFromRpc(rpc, contractHash, agentHash, {
      readPolicy: "fast-fail",
    });

    if (!rep) {
      const seedBody = {
        agentAccountHash: agentHash,
        score: String(seedScore),
        totalDecisions: "0",
        correctPredictions: "0",
        registeredTs: 0,
      };
      setRouteCache(CACHE_KEY, seedBody);
      return NextResponse.json(seedBody, {
        headers: {
          "Cache-Control": "no-store",
          "X-Data-Source": "seed-fallback",
        },
      });
    }

    const body = {
      agentAccountHash: rep.agentAccountHash,
      score: String(rep.score),
      totalDecisions: String(rep.totalDecisions),
      correctPredictions: String(rep.correctPredictions),
      registeredTs: rep.registeredTs,
    };
    setRouteCache(CACHE_KEY, body);

    return NextResponse.json(body, {
      headers: { "Cache-Control": "no-store", "X-Data-Source": "casper-rpc" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const rateLimited = isRateLimitError(err);
    process.stderr.write(
      `[dashboard/api/reputation] ${message} — returning seed fallback\n`
    );
    return NextResponse.json(fallbackBody, {
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Source": "fallback",
        "X-Data-Warning": rateLimited ? "rate_limited" : message,
      },
    });
  }
}
