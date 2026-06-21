/**
 * Agent process entry point.
 * Instantiates all clients, builds the agent loop, and starts it.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, getRepoDotEnvPath } from "@aegis/shared";
import { AgentLoop } from "./loop.js";
import { CasperReadClient } from "./clients/casper-read-client.js";
import {
  OracleClient,
  mockSign,
  buildRealSigner,
} from "./clients/oracle-client.js";
import { CasperTxClient, MockTxClient } from "./clients/casper-tx-client.js";
import { createLlmClient, MockLlmClient } from "./clients/llm-client.js";
import { startTriggerServer } from "./trigger-server.js";

const env = loadEnv();
const offlineDemo = env.AGENT_OFFLINE_DEMO;

// In offline-demo mode no real account is touched, so a real account hash is
// not required — fall back to a clearly-marked demo hash so the loop can run
// with zero configuration / zero API keys.
const DEMO_ACCOUNT_HASH =
  "account-hash-0000000000000000000000000000000000000000000000000000000000000000";
const agentAccountHash =
  env.AGENT_ACCOUNT_HASH || (offlineDemo ? DEMO_ACCOUNT_HASH : "");

if (!agentAccountHash) {
  throw new Error(
    "AGENT_ACCOUNT_HASH is required to run the agent (or set AGENT_OFFLINE_DEMO=true for a self-contained local demo)"
  );
}

if (offlineDemo) {
  process.stdout.write(
    JSON.stringify({
      level: "warn",
      service: "agent",
      msg: "AGENT_OFFLINE_DEMO=true — self-contained local demo: placeholder chain reads, mock LLM, MOCK tx client (no real on-chain submission, no API keys required)",
    }) + "\n"
  );
}

const casperRead = new CasperReadClient(
  env.CSPR_CLOUD_API_URL,
  env.CSPR_CLOUD_API_KEY,
  env.VAULT_CONTRACT_HASH,
  env.REGISTRY_CONTRACT_HASH,
  env.CASPER_NODE_RPC_URL,
  agentAccountHash,
  offlineDemo
);

// ── Signer resolution ─────────────────────────────────────────────────────────
// When AGENT_PRIVATE_KEY_HEX is set, sign x402 payloads with the real ed25519
// key via casper-js-sdk. Without a key (testnet demo / CI), fall back to the
// constant mock signature and log a clear warning.

let oracleSign: (data: Buffer) => string;

if (env.AGENT_PRIVATE_KEY_HEX) {
  try {
    oracleSign = await buildRealSigner(
      env.AGENT_PRIVATE_KEY_HEX,
      env.AGENT_KEY_ALGORITHM
    );
    process.stdout.write(
      JSON.stringify({
        level: "info",
        service: "agent",
        msg: `x402 signer: using real ${env.AGENT_KEY_ALGORITHM} key from AGENT_PRIVATE_KEY_HEX`,
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
  agentAccountHash: agentAccountHash,
  sign: oracleSign,
});

// Offline demo → in-memory mock tx client (never submits on-chain) + mock LLM
// (deterministic, no API key). Otherwise the real casper-js-sdk tx client and
// the configured LLM provider.
const tx = offlineDemo
  ? new MockTxClient()
  : new CasperTxClient({
      privateKeyHex: env.AGENT_PRIVATE_KEY_HEX ?? "",
      keyAlgorithm: env.AGENT_KEY_ALGORITHM,
      accountHash: agentAccountHash,
      nodeRpcUrl: env.CASPER_NODE_RPC_URL,
      network: env.CASPER_NETWORK,
      vaultContractHash: env.VAULT_CONTRACT_HASH,
      registryContractHash: env.REGISTRY_CONTRACT_HASH,
      csprCloudApiKey: env.CSPR_CLOUD_API_KEY,
    });

const llm = offlineDemo ? new MockLlmClient() : createLlmClient(env);

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
    reputationSeedScore: BigInt(env.REPUTATION_SEED_SCORE),
    agentAccountHash: agentAccountHash,
    decisionsLogPath: path.join(repoRoot, "logs", "decisions.jsonl"),
    paymentsLogPath: path.join(repoRoot, "logs", "payments.jsonl"),
    offlineDemo,
  },
  { casperRead, oracle, llm, tx }
);

process.stdout.write(
  JSON.stringify({
    level: "info",
    service: "agent",
    msg: "Agent starting",
    interval_ms: env.AGENT_LOOP_INTERVAL_MS,
    env_file: getRepoDotEnvPath() ?? "none",
    account: agentAccountHash,
    llmProvider: offlineDemo ? "mock (offline demo)" : env.LLM_PROVIDER,
    offlineDemo,
  }) + "\n"
);

loop.start(env.AGENT_LOOP_INTERVAL_MS);
startTriggerServer(loop, env.AGENT_TRIGGER_PORT);
