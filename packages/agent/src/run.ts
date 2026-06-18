/**
 * Agent process entry point.
 * Instantiates all clients, builds the agent loop, and starts it.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@aegis/shared";
import { AgentLoop } from "./loop.js";
import { CasperReadClient } from "./clients/casper-read-client.js";
import {
  OracleClient,
  mockSign,
  buildRealSigner,
} from "./clients/oracle-client.js";
import { CasperTxClient } from "./clients/casper-tx-client.js";
import { createLlmClient } from "./clients/llm-client.js";

const env = loadEnv();

if (!env.AGENT_ACCOUNT_HASH) {
  throw new Error("AGENT_ACCOUNT_HASH is required to run the agent");
}

const casperRead = new CasperReadClient(
  env.CSPR_CLOUD_API_URL,
  env.CSPR_CLOUD_API_KEY,
  env.VAULT_CONTRACT_HASH,
  env.REGISTRY_CONTRACT_HASH
);

// ── Signer resolution ─────────────────────────────────────────────────────────
// When AGENT_PRIVATE_KEY_HEX is set, sign x402 payloads with the real ed25519
// key via casper-js-sdk. Without a key (testnet demo / CI), fall back to the
// constant mock signature and log a clear warning.

let oracleSign: (data: Buffer) => string;

if (env.AGENT_PRIVATE_KEY_HEX) {
  try {
    oracleSign = await buildRealSigner(env.AGENT_PRIVATE_KEY_HEX);
    process.stdout.write(
      JSON.stringify({
        level: "info",
        service: "agent",
        msg: "x402 signer: using real ed25519 key from AGENT_PRIVATE_KEY_HEX",
      }) + "\n"
    );
  } catch (err) {
    // SDK import failure or malformed key — log and fall back to mock sign so
    // the agent can still start in degraded mode rather than crashing.
    process.stdout.write(
      JSON.stringify({
        level: "warn",
        service: "agent",
        msg: "x402 signer: failed to build real signer, falling back to mockSign — payment gating is NOT enforced",
        reason: err instanceof Error ? err.message : String(err),
      }) + "\n"
    );
    oracleSign = mockSign;
  }
} else {
  process.stdout.write(
    JSON.stringify({
      level: "warn",
      service: "agent",
      msg: "x402 signer: AGENT_PRIVATE_KEY_HEX not set — using mockSign, payment gating is NOT enforced (testnet demo mode)",
    }) + "\n"
  );
  oracleSign = mockSign;
}

const oracle = new OracleClient({
  oracleUrl: env.ORACLE_URL,
  oraclePriceMotes: env.ORACLE_PRICE_MOTES,
  agentAccountHash: env.AGENT_ACCOUNT_HASH,
  sign: oracleSign,
});

const tx = new CasperTxClient({
  privateKeyHex: env.AGENT_PRIVATE_KEY_HEX ?? "",
  accountHash: env.AGENT_ACCOUNT_HASH,
  nodeRpcUrl: env.CASPER_NODE_RPC_URL,
  network: env.CASPER_NETWORK,
  vaultContractHash: env.VAULT_CONTRACT_HASH,
  registryContractHash: env.REGISTRY_CONTRACT_HASH,
});

const llm = createLlmClient(env);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const loop = new AgentLoop(
  {
    reallocationDriftBps: env.REALLOCATION_DRIFT_BPS,
    minConfidenceThreshold: env.MIN_CONFIDENCE_THRESHOLD,
    minVaultBalanceMotes: env.MIN_VAULT_BALANCE_MOTES,
    maxAssetWeightBps: env.MAX_ASSET_WEIGHT_BPS,
    txConfirmTimeoutMs: env.TX_CONFIRM_TIMEOUT_MS,
    reputationUpdateEpochs: env.REPUTATION_UPDATE_EPOCHS,
    agentAccountHash: env.AGENT_ACCOUNT_HASH,
    decisionsLogPath: path.join(repoRoot, "logs", "decisions.jsonl"),
    paymentsLogPath: path.join(repoRoot, "logs", "payments.jsonl"),
  },
  { casperRead, oracle, llm, tx }
);

process.stdout.write(
  JSON.stringify({
    level: "info",
    service: "agent",
    msg: "Agent starting",
    interval_ms: env.AGENT_LOOP_INTERVAL_MS,
    account: env.AGENT_ACCOUNT_HASH,
    llmProvider: env.LLM_PROVIDER,
  }) + "\n"
);

loop.start(env.AGENT_LOOP_INTERVAL_MS);
