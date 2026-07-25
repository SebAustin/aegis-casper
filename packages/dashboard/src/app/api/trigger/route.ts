import { NextResponse } from "next/server";
import { generateDemoDecision, type DecisionLogEntry } from "@aegis/shared";
import { isDemoMode } from "@/lib/demo-mode";

interface TriggerResponse {
  triggered: true;
  demo?: true;
  decision?: DecisionLogEntry;
}

function demoTriggerResponse(): NextResponse<TriggerResponse> {
  return NextResponse.json({
    triggered: true,
    demo: true,
    decision: generateDemoDecision(),
  });
}

/**
 * POST /api/trigger
 *
 * FR-D-07: Triggers an immediate agent loop iteration by POSTing to the
 * agent's internal trigger endpoint. The agent process listens on
 * AGENT_TRIGGER_URL (server-only env var — never exposed to client).
 *
 * NFR-S-01: The agent private key never transits this API. The agent
 * process already holds it.
 *
 * Demo mode (`NEXT_PUBLIC_DEMO_MODE=true`, set on the hosted Vercel deploy
 * where no agent process is reachable): instead of forwarding to
 * AGENT_TRIGGER_URL, generate one fresh simulated `DecisionLogEntry`
 * server-side — pure function, no LLM call, no chain write, no persistence.
 * The response is clearly marked `demo: true` so the client never implies an
 * on-chain submission happened. The real-agent path below is unchanged and
 * is still attempted first whenever demo mode is off.
 */
export async function POST(): Promise<NextResponse> {
  if (isDemoMode()) {
    return demoTriggerResponse();
  }

  const triggerUrl = process.env["AGENT_TRIGGER_URL"] ?? "http://localhost:4022/trigger";

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8_000);

    const res = await fetch(triggerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.status === 429) {
      return NextResponse.json(
        { error: "Agent trigger rate limit — wait a few seconds and retry." },
        { status: 429 }
      );
    }

    if (res.status === 503) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        cooldownRemainingMs?: number;
      };
      const cooldownMs = body.cooldownRemainingMs ?? 0;
      const retryAfter =
        res.headers.get("Retry-After") ??
        (cooldownMs > 0 ? String(Math.ceil(cooldownMs / 1000)) : null);
      return NextResponse.json(
        {
          error: body.error ?? "Agent in RPC cooldown — try again shortly.",
          cooldownRemainingMs: cooldownMs,
        },
        {
          status: 503,
          headers: retryAfter ? { "Retry-After": retryAfter } : undefined,
        }
      );
    }

    if (!res.ok) {
      throw new Error(`Agent trigger returned ${res.status}`);
    }

    return NextResponse.json({ triggered: true });
  } catch {
    // The real agent process could not be reached at all (connection
    // refused, DNS failure, timeout) — this is exactly the hosted/serverless
    // situation described in the module docstring, so fall back to a demo
    // decision rather than a dead 503. Explicit 429/503 responses from a
    // *reachable* agent are returned above, unchanged.
    return demoTriggerResponse();
  }
}
