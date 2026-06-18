import { NextResponse } from "next/server";

/**
 * POST /api/trigger
 *
 * FR-D-07: Triggers an immediate agent loop iteration by POSTing to the
 * agent's internal trigger endpoint. The agent process listens on
 * AGENT_TRIGGER_URL (server-only env var — never exposed to client).
 *
 * NFR-S-01: The agent private key never transits this API. The agent
 * process already holds it.
 */
export async function POST(): Promise<NextResponse> {
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

    if (!res.ok) {
      throw new Error(`Agent trigger returned ${res.status}`);
    }

    return NextResponse.json({ triggered: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Agent run failed to start. Check that the agent process is running. (${message})` },
      { status: 503 }
    );
  }
}
