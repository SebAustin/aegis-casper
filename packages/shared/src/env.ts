/**
 * Fail-fast environment loader (NFR-S-01).
 *
 * Validates all required env vars at startup using Zod.
 * Throws with a clear message on the first missing/malformed variable.
 * Secrets are never logged — only the variable NAME is mentioned in errors.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z, ZodError } from "zod";

// ── Schema ────────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // Casper network
  CASPER_NETWORK: z.string().min(1).default("casper-test"),
  CASPER_NODE_RPC_URL: z
    .string()
    .url()
    .default("https://node.testnet.cspr.cloud/rpc"),
  CSPR_CLOUD_API_URL: z
    .string()
    .url()
    .default("https://api.testnet.cspr.cloud"),
  CSPR_CLOUD_API_KEY: z.string().min(1).optional(),

  // Contract hashes (populated after deploy)
  VAULT_CONTRACT_HASH: z.string().optional(),
  REGISTRY_CONTRACT_HASH: z.string().optional(),

  // Agent signing
  AGENT_PRIVATE_KEY_HEX: z.string().optional(),
  AGENT_ACCOUNT_HASH: z.string().optional(),
  /** Casper key algorithm for AGENT_PRIVATE_KEY_HEX (default ed25519). */
  AGENT_KEY_ALGORITHM: z.enum(["ed25519", "secp256k1"]).default("ed25519"),

  // LLM provider
  LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o"),

  // Oracle
  ORACLE_PORT: z.coerce.number().int().min(1).default(4021),
  ORACLE_URL: z.string().url().default("http://localhost:4021"),
  ORACLE_PRICE_MOTES: z.coerce.bigint().positive().default(BigInt(1_000_000)),
  ORACLE_PAYEE_ACCOUNT_HASH: z
    .string()
    .default("oracle-payee-account-hash-placeholder"),
  X402_FACILITATOR: z.enum(["mock", "live"]).default("mock"),
  X402_FACILITATOR_URL: z.string().optional(),

  // Agent loop
  // Default 15 min keeps an online run (~2 reads/iteration) under the
  // CSPR.cloud free-tier daily quota (~1200/day). Offline demo auto-uses a
  // faster cadence (see resolveLoopIntervalMs). Set 30000 for a live online demo.
  AGENT_LOOP_INTERVAL_MS: z.coerce.number().int().min(1000).default(900_000),
  /** Localhost HTTP port for dashboard POST /api/trigger → agent /trigger. */
  AGENT_TRIGGER_PORT: z.coerce.number().int().min(1).default(4022),
  /**
   * Opt-in self-contained local demo. When true the agent runs the full
   * perceive→decide→act cycle entirely offline: chain reads return seeded
   * placeholder state (no CSPR.cloud calls, no quota burn), and ACT is routed
   * to an in-memory mock tx client that returns clearly-marked `mock-…`
   * hashes — it NEVER submits a real on-chain transaction. Parsed explicitly
   * (`true`/`1`) rather than via z.coerce.boolean (which treats "false" as true).
   */
  AGENT_OFFLINE_DEMO: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  REALLOCATION_DRIFT_BPS: z.coerce.number().int().min(0).default(200),
  MIN_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(100).default(60),
  MIN_VAULT_BALANCE_MOTES: z.coerce
    .bigint()
    .nonnegative()
    .default(BigInt(100_000_000_000)),
  MAX_ASSET_WEIGHT_BPS: z.coerce.number().int().min(1).max(10_000).default(6000),
  TX_CONFIRM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60_000),
  REPUTATION_UPDATE_EPOCHS: z.coerce.number().int().min(1).default(3),
  REPUTATION_SEED_SCORE: z.coerce.number().int().min(0).default(50),

  // Deploy guard
  ALLOW_TESTNET_DEPLOY: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof envSchema>;

let _cached: Env | null = null;
let _dotEnvHydrated = false;

/** Keys that repo-root `.env` always wins over pre-set process.env (local dev tuning). */
const REPO_DOTENV_OVERRIDE_KEYS = new Set(["AGENT_LOOP_INTERVAL_MS"]);

/**
 * Walk up from cwd to find the monorepo `.env` (repo root when running
 * `pnpm agent` / `pnpm oracle` from any package directory).
 */
export function getRepoDotEnvPath(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  for (let depth = 0; depth < 12; depth++) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findRepoDotEnv(): string | null {
  return getRepoDotEnvPath();
}

/** Merge repo-root `.env` into `process.env` without overriding existing vars. */
function hydrateProcessEnvFromRepoDotEnv(): void {
  if (_dotEnvHydrated) return;
  _dotEnvHydrated = true;

  const envPath = findRepoDotEnv();
  if (!envPath) return;

  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      // Strip trailing inline comments (`KEY=value # note`) common in .env.example.
      value = value.replace(/\s+#.*$/, "").trim();
    }
    if (
      process.env[key] === undefined ||
      REPO_DOTENV_OVERRIDE_KEYS.has(key)
    ) {
      process.env[key] = value;
    }
  }
}

/**
 * Load and validate environment variables.
 *
 * Called once at process startup. Results are cached.
 * Throws with a human-readable message listing every invalid/missing var
 * (by name, never by value) if validation fails.
 *
 * @param raw - Override the source object (defaults to `process.env`). Useful
 *              in tests to supply a mock environment without touching the real
 *              process env.
 */
export function loadEnv(raw: Record<string, string | undefined> = process.env): Env {
  if (raw === process.env) {
    hydrateProcessEnvFromRepoDotEnv();
  }

  if (_cached !== null) {
    return _cached;
  }

  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const issues = formatZodError(result.error);
    throw new Error(
      `[aegis/env] Environment validation failed:\n${issues}\n` +
        `Copy .env.example to .env and fill in the required values.`
    );
  }

  _cached = result.data;
  return _cached;
}

/**
 * Reset the cached env (only for tests — do not call in production code).
 */
export function _resetEnvCache(): void {
  _cached = null;
  _dotEnvHydrated = false;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return `  • ${path}: ${issue.message}`;
    })
    .join("\n");
}

/**
 * Load the agent-specific required vars and throw if any are absent.
 * Called by packages that need the signing key.
 */
export function requireAgentEnv(raw = process.env): Env & {
  AGENT_PRIVATE_KEY_HEX: string;
  AGENT_ACCOUNT_HASH: string;
} {
  const env = loadEnv(raw);

  const missing: string[] = [];
  if (!env.AGENT_PRIVATE_KEY_HEX) missing.push("AGENT_PRIVATE_KEY_HEX");
  if (!env.AGENT_ACCOUNT_HASH) missing.push("AGENT_ACCOUNT_HASH");

  if (missing.length > 0) {
    throw new Error(
      `[aegis/env] Missing required agent vars: ${missing.join(", ")}`
    );
  }

  return env as Env & {
    AGENT_PRIVATE_KEY_HEX: string;
    AGENT_ACCOUNT_HASH: string;
  };
}
