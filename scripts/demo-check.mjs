#!/usr/bin/env node
/**
 * Smoke-check local Aegis stack (oracle, agent trigger, dashboard APIs).
 * Exit 0 when all probes pass; non-zero on first failure.
 */

const ORACLE = process.env.ORACLE_URL ?? "http://localhost:4021";
const DASHBOARD = process.env.DASHBOARD_URL ?? "http://localhost:3000";

const checks = [
  {
    name: "oracle health",
    url: `${ORACLE}/api/health`,
    validate: async (res, body) => {
      if (!res.ok) return `HTTP ${res.status}`;
      const data = JSON.parse(body);
      return data.status === "ok" ? null : "status !== ok";
    },
  },
  {
    name: "oracle latest",
    url: `${ORACLE}/api/oracle/latest`,
    validate: async (res, body) => {
      if (!res.ok) return `HTTP ${res.status}`;
      const data = JSON.parse(body);
      if (!Array.isArray(data.assets) || data.assets.length !== 5) {
        return "expected 5 assets";
      }
      if (Date.now() - data.timestamp > 60_000) {
        return "timestamp older than 60s";
      }
      return null;
    },
  },
  {
    name: "dashboard vault",
    url: `${DASHBOARD}/api/vault`,
    validate: async (res) => (res.ok ? null : `HTTP ${res.status}`),
  },
  {
    name: "dashboard reputation",
    url: `${DASHBOARD}/api/reputation`,
    validate: async (res) => (res.ok ? null : `HTTP ${res.status}`),
  },
  {
    name: "dashboard decisions",
    url: `${DASHBOARD}/api/decisions`,
    validate: async (res, body) => {
      if (!res.ok) return `HTTP ${res.status}`;
      const data = JSON.parse(body);
      return Array.isArray(data) ? null : "expected array";
    },
  },
  {
    name: "dashboard oracle",
    url: `${DASHBOARD}/api/oracle`,
    validate: async (res, body) => {
      if (!res.ok) return `HTTP ${res.status}`;
      const data = JSON.parse(body);
      if (!Array.isArray(data.assets) || data.assets.length !== 5) {
        return "expected 5 assets";
      }
      return null;
    },
  },
];

let failed = 0;

for (const check of checks) {
  const start = Date.now();
  try {
    const res = await fetch(check.url, { signal: AbortSignal.timeout(10_000) });
    const body = await res.text();
    const err = await check.validate(res, body);
    const ms = Date.now() - start;
    if (err) {
      console.error(`FAIL ${check.name} (${ms}ms): ${err}`);
      failed++;
    } else {
      console.log(`OK   ${check.name} (${ms}ms)`);
    }
  } catch (e) {
    console.error(`FAIL ${check.name}: ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed. Is the stack running? (pnpm oracle, pnpm agent, pnpm dev)`);
  process.exit(1);
}

console.log("\nAll demo checks passed.");
