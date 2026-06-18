/**
 * @aegis/agent public API.
 */

export { AgentLoop, defaultDecisionsLogPath, defaultPaymentsLogPath } from "./loop.js";
export type { AgentConfig, AgentClients } from "./loop.js";

export {
  AnthropicClient,
  OpenAiClient,
  MockLlmClient,
  createLlmClient,
  buildDecisionPrompt,
} from "./clients/llm-client.js";

export { CasperReadClient } from "./clients/casper-read-client.js";

export {
  OracleClient,
  computeCanonicalDigest,
  mockSign,
} from "./clients/oracle-client.js";
export type { OracleClientConfig } from "./clients/oracle-client.js";

export {
  CasperTxClient,
  MockTxClient,
} from "./clients/casper-tx-client.js";
export type { TxClient, TxResult } from "./clients/casper-tx-client.js";

export { computeReputationDelta, hashDecisions } from "./reputation.js";
