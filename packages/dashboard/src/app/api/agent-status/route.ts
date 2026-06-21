import { NextResponse } from "next/server";

export interface AgentStatusPayload {
  reachable: boolean;
  iterationRunning: boolean;
  inRpcCooldown: boolean;
  rpcCooldownRemainingMs: number;
}

/**
 * GET /api/agent-status
 *
 * Proxies the agent trigger server's /status for dashboard cooldown UX.
 */
export async function GET(): Promise<NextResponse<AgentStatusPayload>> {
  const triggerUrl = process.env["AGENT_TRIGGER_URL"] ?? "http://localhost:4022/trigger";
  const statusUrl = triggerUrl.replace(/\/trigger\/?$/, "/status");

  try {
    const res = await fetch(statusUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });

    if (!res.ok) {
      throw new Error(`status ${res.status}`);
    }

    const body = (await res.json()) as {
      iterationRunning?: boolean;
      inRpcCooldown?: boolean;
      rpcCooldownRemainingMs?: number;
    };

    return NextResponse.json(
      {
        reachable: true,
        iterationRunning: body.iterationRunning === true,
        inRpcCooldown: body.inRpcCooldown === true,
        rpcCooldownRemainingMs: body.rpcCooldownRemainingMs ?? 0,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      {
        reachable: false,
        iterationRunning: false,
        inRpcCooldown: false,
        rpcCooldownRemainingMs: 0,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
