/**
 * Localhost HTTP trigger server for the dashboard "Trigger Agent Run" button.
 *
 * Binds to 127.0.0.1 only (SEC-07). Accepts POST /trigger and schedules a
 * single agent iteration without blocking until the LLM / on-chain act finishes.
 */

import http from "node:http";
import type { AgentLoop } from "./loop.js";

const MIN_INTERVAL_MS = 5_000;

export function startTriggerServer(
  loop: AgentLoop,
  port: number
): http.Server {
  let lastTriggerAt = 0;

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/status") {
      const cooldownRemainingMs = loop.getRpcCooldownRemainingMs();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          iterationRunning: loop.isIterationRunning(),
          inRpcCooldown: loop.isInRpcCooldown(),
          rpcCooldownRemainingMs: cooldownRemainingMs,
        })
      );
      return;
    }

    if (req.method !== "POST" || req.url !== "/trigger") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    const now = Date.now();
    if (now - lastTriggerAt < MIN_INTERVAL_MS) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Trigger rate limit — wait a few seconds and retry.",
        })
      );
      return;
    }

    if (loop.isInRpcCooldown()) {
      const cooldownRemainingMs = loop.getRpcCooldownRemainingMs();
      const remainingSec = Math.ceil(cooldownRemainingMs / 1000);
      res.writeHead(503, {
        "Content-Type": "application/json",
        "Retry-After": String(remainingSec),
      });
      res.end(
        JSON.stringify({
          error: `Agent in RPC cooldown — try again in ${remainingSec}s.`,
          cooldownRemainingMs,
        })
      );
      return;
    }

    lastTriggerAt = now;

    process.stdout.write(
      JSON.stringify({
        level: "info",
        service: "agent",
        msg: "Manual trigger received from dashboard",
      }) + "\n"
    );

    void loop.runOnce().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        JSON.stringify({
          level: "error",
          service: "agent",
          msg: "Manual trigger iteration failed",
          error: message,
        }) + "\n"
      );
    });

    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ accepted: true, triggered: true }));
  });

  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(
      JSON.stringify({
        level: "info",
        service: "agent",
        msg: "Trigger server listening",
        port,
        path: "/trigger",
      }) + "\n"
    );
  });

  return server;
}
