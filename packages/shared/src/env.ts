/**
 * Fail-fast environment loader (NFR-S-01).
 *
 * Validates all required env vars at startup using Zod.
 * Throws with a clear message on the first missing/malformed variable.
 * Secrets are never logged — only the variable NAME is mentioned in errors.
 */

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
  AGENT_LOOP_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
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
