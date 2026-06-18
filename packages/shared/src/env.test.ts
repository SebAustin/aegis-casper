import { describe, it, expect, afterEach } from "vitest";
import { loadEnv, _resetEnvCache } from "./env.js";

afterEach(() => {
  _resetEnvCache();
});

describe("loadEnv", () => {
  it("loads successfully with only defaults (all optional vars absent)", () => {
    const env = loadEnv({});
    expect(env.CASPER_NETWORK).toBe("casper-test");
    expect(env.LLM_PROVIDER).toBe("anthropic");
    expect(env.ORACLE_PORT).toBe(4021);
    expect(env.ORACLE_PRICE_MOTES).toBe(BigInt(1_000_000));
    expect(env.AGENT_LOOP_INTERVAL_MS).toBe(30_000);
  });

  it("parses numeric strings correctly", () => {
    const env = loadEnv({ ORACLE_PORT: "8080", AGENT_LOOP_INTERVAL_MS: "60000" });
    expect(env.ORACLE_PORT).toBe(8080);
    expect(env.AGENT_LOOP_INTERVAL_MS).toBe(60_000);
  });

  it("coerces ORACLE_PRICE_MOTES to bigint", () => {
    const env = loadEnv({ ORACLE_PRICE_MOTES: "2000000" });
    expect(env.ORACLE_PRICE_MOTES).toBe(BigInt(2_000_000));
  });

  it("rejects an invalid LLM_PROVIDER value", () => {
    expect(() => loadEnv({ LLM_PROVIDER: "gemini" })).toThrow();
  });

  it("rejects a non-numeric ORACLE_PORT", () => {
    expect(() => loadEnv({ ORACLE_PORT: "not-a-number" })).toThrow();
  });

  it("returns cached env on subsequent calls without re-validating", () => {
    const env1 = loadEnv({});
    const env2 = loadEnv({}); // same ref because cached
    expect(env1).toBe(env2);
  });

  it("throws with informative message listing the failed field name", () => {
    try {
      loadEnv({ LLM_PROVIDER: "bad" });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(String(err)).toContain("LLM_PROVIDER");
    }
  });
});
