/**
 * Agent process entry point.
 * Instantiates all clients, builds the agent loop, and starts it.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@aegis/shared";
import { AgentLoop } from "./loop.js";
import { CasperReadClient } from "./clients/casper-read-client.js";
import { OracleClient, mockSign } from "./clients/oracle-client.js";
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

const oracle = new OracleClient({
  oracleUrl: env.ORACLE_URL,
  oraclePriceMotes: env.ORACLE_PRICE_MOTES,
  agentAccountHash: env.AGENT_ACCOUNT_HASH,
  // Use real signing when private key is provided
  sign: env.AGENT_PRIVATE_KEY_HEX
    ? (data) => {
        // Placeholder: in production, use casper-js-sdk to sign
        // Returns mockSign until SDK is integrated
        return mockSign(data);
      }
    : mockSign,
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
