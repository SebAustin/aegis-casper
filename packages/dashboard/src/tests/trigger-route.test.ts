import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function importRoute() {
  vi.resetModules();
  const mod = await import("@/app/api/trigger/route");
  return mod;
}

describe("POST /api/trigger — demo mode", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it("returns a demo decision when NEXT_PUBLIC_DEMO_MODE=true", async () => {
    process.env["NEXT_PUBLIC_DEMO_MODE"] = "true";
    const { POST } = await importRoute();

    const res = await POST();
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      triggered: boolean;
      demo?: boolean;
      decision?: { recommendedAllocation: Array<{ assetId: number; bps: number }> };
    };

    expect(body.triggered).toBe(true);
    expect(body.demo).toBe(true);
    expect(body.decision).toBeDefined();
    expect(body.decision!.recommendedAllocation).toHaveLength(5);
    const sum = body.decision!.recommendedAllocation.reduce((acc, e) => acc + e.bps, 0);
    expect(sum).toBe(10_000);
  });

  it("falls back to a demo decision when the real agent is unreachable", async () => {
    delete process.env["NEXT_PUBLIC_DEMO_MODE"];
    process.env["AGENT_TRIGGER_URL"] = "http://127.0.0.1:1/trigger";
    const { POST } = await importRoute();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"))
    );

    const res = await POST();
    expect(res.status).toBe(200);

    const body = (await res.json()) as { triggered: boolean; demo?: boolean };
    expect(body.triggered).toBe(true);
    expect(body.demo).toBe(true);
  });

  it("keeps the real 503 cooldown response unchanged when the agent IS reachable", async () => {
    delete process.env["NEXT_PUBLIC_DEMO_MODE"];
    process.env["AGENT_TRIGGER_URL"] = "http://127.0.0.1:4022/trigger";
    const { POST } = await importRoute();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: "Agent in RPC cooldown", cooldownRemainingMs: 4000 }),
          { status: 503 }
        )
      )
    );

    const res = await POST();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; cooldownRemainingMs: number };
    expect(body.error).toBe("Agent in RPC cooldown");
    expect(body.cooldownRemainingMs).toBe(4000);
  });
});
