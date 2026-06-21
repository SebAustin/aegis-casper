/**
 * MCP server process entry point.
 * Run via: pnpm --filter @aegis/mcp-server start
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@aegis/shared";
import { CasperReadClient, OracleClient, MockTxClient, mockSign } from "@aegis/agent";
import { startMcpServer } from "./mcp-server.js";

const env = loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const casperRead = new CasperReadClient(
  env.CSPR_CLOUD_API_URL,
  env.CSPR_CLOUD_API_KEY,
  env.VAULT_CONTRACT_HASH,
  env.REGISTRY_CONTRACT_HASH,
  env.CASPER_NODE_RPC_URL,
  env.AGENT_ACCOUNT_HASH ?? ""
);

const oracle = new OracleClient({
  oracleUrl: env.ORACLE_URL,
  oraclePriceMotes: env.ORACLE_PRICE_MOTES,
  agentAccountHash: env.AGENT_ACCOUNT_HASH ?? "default-agent-hash",
  sign: mockSign,
});

// Use MockTxClient for MCP — the real tx client requires a private key
// and is only appropriate in the agent process (FR-W-04)
const tx = new MockTxClient();

await startMcpServer({
  casperRead,
  oracle,
  tx,
  decisionsLogPath: path.join(repoRoot, "logs", "decisions.jsonl"),
  agentAccountHash: env.AGENT_ACCOUNT_HASH ?? "default-agent-hash",
});
