/**
 * Aegis MCP server — 6 tools + 4 resources over stdio (FR-M-01..05, A-015).
 *
 * Uses @modelcontextprotocol/sdk with the stdio transport.
 * All tool invocations are logged to stderr (stdout is the MCP channel).
 * Server never crashes on a tool failure — errors are returned as MCP error objects (NFR-R-02).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readJsonl } from "@aegis/shared";
import type { DecisionLogEntry, AllocationMap } from "@aegis/shared";
import {
  handleGetVaultState,
  handleGetAgentReputation,
  handleSubmitReallocation,
  handleFetchRwaOracleData,
  handleGetDecisionLog,
  handleGetTransactionStatus,
  type ToolContext,
} from "./tools.js";

// ── Tool schemas ──────────────────────────────────────────────────────────────

const allocationEntrySchema = z.object({
  assetId: z.number().int().min(0).max(4),
  bps: z.number().int().min(0).max(10_000),
});

// ── Server factory ────────────────────────────────────────────────────────────

export function createMcpServer(ctx: ToolContext): Server {
  const server = new Server(
    { name: "aegis-mcp", version: "1.0.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // ── List tools ─────────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_vault_state",
          description: "Query current vault state from Casper testnet",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
        },
        {
          name: "get_agent_reputation",
          description: "Query agent reputation from the registry contract",
          inputSchema: {
            type: "object",
            properties: {
              agent_account_hash: {
                type: "string",
                description: "Agent account hash to query",
              },
            },
            required: ["agent_account_hash"],
          },
        },
        {
          name: "submit_reallocation",
          description:
            "Submit a signed reallocate transaction to the vault. Pass dry_run=true for smoke testing.",
          inputSchema: {
            type: "object",
            properties: {
              allocation: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    assetId: { type: "number" },
                    bps: { type: "number" },
                  },
                  required: ["assetId", "bps"],
                },
                description: "5-entry allocation map, bps sums to 10000",
              },
              dry_run: {
                type: "boolean",
                description: "If true, returns a mock response without submitting",
              },
            },
            required: ["allocation"],
          },
        },
        {
          name: "fetch_rwa_oracle_data",
          description: "Fetch RWA yield data from the x402-gated oracle",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
        },
        {
          name: "get_decision_log",
          description: "Read the last N agent decisions from the decision log",
          inputSchema: {
            type: "object",
            properties: {
              limit: {
                type: "number",
                description: "Maximum number of entries to return (default 20, max 100)",
              },
            },
            required: [],
          },
        },
        {
          name: "get_transaction_status",
          description: "Query the status of a transaction by its hash",
          inputSchema: {
            type: "object",
            properties: {
              tx_hash: {
                type: "string",
                description: "Transaction/deploy hash to query",
              },
            },
            required: ["tx_hash"],
          },
        },
      ],
    };
  });

  // ── Call tool ──────────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const timestamp = new Date().toISOString();

    // Structured tool invocation log to stderr (FR-M-04)
    process.stderr.write(
      JSON.stringify({
        level: "info",
        service: "mcp",
        timestamp,
        tool: name,
        args: sanitizeArgs(name, args),
      }) + "\n"
    );

    try {
      let result: unknown;

      switch (name) {
        case "get_vault_state": {
          result = await handleGetVaultState(ctx);
          break;
        }
        case "get_agent_reputation": {
          const parsed = z
            .object({ agent_account_hash: z.string().min(1) })
            .parse(args ?? {});
          result = await handleGetAgentReputation(ctx, parsed);
          break;
        }
        case "submit_reallocation": {
          const parsed = z
            .object({
              allocation: z.array(allocationEntrySchema),
              dry_run: z.boolean().optional(),
            })
            .parse(args ?? {});
          result = await handleSubmitReallocation(ctx, {
            allocation: parsed.allocation as AllocationMap,
            dry_run: parsed.dry_run,
          });
          break;
        }
        case "fetch_rwa_oracle_data": {
          result = await handleFetchRwaOracleData(ctx);
          break;
        }
        case "get_decision_log": {
          const parsed = z
            .object({ limit: z.number().int().min(1).max(100).optional() })
            .parse(args ?? {});
          result = await handleGetDecisionLog(ctx, parsed);
          break;
        }
        case "get_transaction_status": {
          const parsed = z
            .object({ tx_hash: z.string().min(1) })
            .parse(args ?? {});
          result = await handleGetTransactionStatus(ctx, parsed);
          break;
        }
        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }

      return {
        content: [
          { type: "text", text: JSON.stringify(result, bigIntReplacer, 2) },
        ],
      };
    } catch (err) {
      // NFR-R-02: structured error, never crash
      process.stderr.write(
        JSON.stringify({
          level: "error",
          service: "mcp",
          timestamp,
          tool: name,
          error: String(err),
        }) + "\n"
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          },
        ],
        isError: true,
      };
    }
  });

  // ── List resources ─────────────────────────────────────────────────────────

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "aegis://vault/state",
          name: "Vault State",
          description: "Live vault state (balance, shares, allocation)",
          mimeType: "application/json",
        },
        {
          uri: "aegis://agent/reputation",
          name: "Agent Reputation",
          description: "Agent reputation profile from the registry contract",
          mimeType: "application/json",
        },
        {
          uri: "aegis://decisions/recent",
          name: "Recent Decisions",
          description: "Last 10 agent decision log entries",
          mimeType: "application/json",
        },
        {
          uri: "aegis://oracle/latest",
          name: "Oracle Latest",
          description: "Most recent oracle RWA yield data snapshot",
          mimeType: "application/json",
        },
      ],
    };
  });

  // ── Read resource ──────────────────────────────────────────────────────────

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const timestamp = new Date().toISOString();

    process.stderr.write(
      JSON.stringify({
        level: "info",
        service: "mcp",
        timestamp,
        resource: uri,
      }) + "\n"
    );

    try {
      let data: unknown;

      if (uri === "aegis://vault/state") {
        data = await handleGetVaultState(ctx);
      } else if (uri === "aegis://agent/reputation") {
        data = await handleGetAgentReputation(ctx, {
          agent_account_hash: ctx.agentAccountHash,
        });
      } else if (uri === "aegis://decisions/recent") {
        const entries = await readJsonl<DecisionLogEntry>(ctx.decisionsLogPath, 10);
        data = entries;
      } else if (uri === "aegis://oracle/latest") {
        data = await handleFetchRwaOracleData(ctx);
      } else {
        throw new Error(`Unknown resource URI: ${uri}`);
      }

      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(data, bigIntReplacer, 2),
          },
        ],
      };
    } catch (err) {
      process.stderr.write(
        JSON.stringify({
          level: "error",
          service: "mcp",
          timestamp,
          resource: uri,
          error: String(err),
        }) + "\n"
      );
      throw err;
    }
  });

  return server;
}

/**
 * Connect the server to the stdio transport and start listening.
 */
export async function startMcpServer(ctx: ToolContext): Promise<void> {
  const server = createMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    JSON.stringify({
      level: "info",
      service: "mcp",
      msg: "Aegis MCP server started on stdio",
    }) + "\n"
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/**
 * Remove sensitive fields from args before logging (NFR-S-01, FR-W-04).
 * The `agent_private_key_hex` argument is never logged.
 */
function sanitizeArgs(toolName: string, args: unknown): unknown {
  if (toolName === "submit_reallocation" && args && typeof args === "object") {
    const { agent_private_key_hex: _, ...safe } = args as Record<string, unknown>;
    return safe;
  }
  return args;
}
