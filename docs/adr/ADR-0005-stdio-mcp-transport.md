# ADR-0005 — stdio MCP Transport + Custom MCP Server (OQ-05)

**Status:** Accepted
**Date:** 2026-06-18
**Deciders:** Architecture team

---

## Context

Aegis must expose its capabilities to LLM clients through the Model Context Protocol (MCP) so that Claude Desktop, the MCP Inspector, and other MCP-compatible clients can introspect live chain state, query oracle data, read the decision log, and trigger reallocations.

MCP supports two transport mechanisms:
1. **stdio** — the MCP host spawns the server as a child process; communication is over stdin/stdout. No network port, no auth surface, no CORS.
2. **HTTP/SSE** — the server binds a port; multiple clients can connect; requires auth and CORS configuration.

The question of whether to use a custom MCP server vs. a generic framework wrapper was open (OQ-05). Using a generic wrapper might reduce code but would not expose Aegis-specific signing, logging, or tool semantics.

---

## Decision

Use **stdio transport** exclusively for the buildathon MVP.

Implement a **custom MCP server** (`packages/mcp-server`) using `@modelcontextprotocol/sdk` directly, targeting MCP spec version 2025-11-25. The server:

- Exposes 6 tools (`get_vault_state`, `get_agent_reputation`, `submit_reallocation`, `fetch_rwa_oracle_data`, `get_decision_log`, `get_transaction_status`) and 4 resources (`aegis://vault/state`, `aegis://agent/reputation`, `aegis://decisions/recent`, `aegis://oracle/latest`).
- Reuses `CasperReadClient`, `OracleClient`, and `CasperTxClient` from `@aegis/agent` — no logic duplication.
- Logs tool invocations to **stderr** (stdout is the MCP channel and must not be polluted).
- Returns structured MCP error objects on tool failure; never crashes on a tool error.
- Uses server-held context for signing in `submit_reallocation` — the tool does not accept a private key argument (SEC-09).
- Validates all tool input arguments with Zod before passing them to handlers.

Transport is started via `StdioServerTransport` from the SDK. The entry point (`packages/mcp-server/src/server.ts`) connects the server to the transport and starts listening.

**HTTP/SSE transport** is deferred to a post-buildathon federation stretch goal (when multiple agents need to expose their MCP surface over a network).

---

## Consequences

**Positive:**
- Zero network/CORS/auth surface for the demo — works out of the box with MCP Inspector (`npx @modelcontextprotocol/inspector`) and Claude Desktop with no configuration beyond the server path.
- Stdout is exclusively the MCP channel; no accidental mixing of log output into the protocol stream.
- Custom implementation gives full control over signing, error handling, and log semantics. Tool handlers are framework-agnostic functions that could be wrapped behind any transport in the future.
- `submit_reallocation` never exposes the private key as a tool argument — a deliberate security improvement over a naive generic wrapper.

**Negative / trade-offs:**
- stdio transport is single-client (one MCP host per process). Multiple concurrent LLM clients cannot share one MCP server instance in this configuration. HTTP/SSE transport would be required for multi-tenant use.
- The server must be restarted if the MCP host drops the connection; there is no reconnect logic in stdio mode.
- `@aegis/mcp-server` depends on `@aegis/agent` for client reuse, which means the mcp-server package inherits the agent's transitive dependencies. This is acceptable for a monorepo but would need restructuring if the packages were published independently.

**OQ-05 resolution:** A custom MCP server using `@modelcontextprotocol/sdk` was chosen over a generic framework wrapper because Aegis-specific signing logic, audit logging, and the `submit_reallocation` security model cannot be expressed cleanly through a generic tool adapter without equivalent custom code.
