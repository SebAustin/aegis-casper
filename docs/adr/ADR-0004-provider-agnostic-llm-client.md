# ADR-0004 — Provider-Agnostic LlmClient Interface

**Status:** Accepted
**Date:** 2026-06-18
**Deciders:** Architecture team

---

## Context

The agent's `decide` phase requires an LLM to produce a structured allocation recommendation. Multiple LLM providers are viable (Anthropic Claude, OpenAI GPT-4o, local models) and the buildathon demo must run without any LLM API key for evaluators who want to test the system without cost.

If the agent imports the Anthropic or OpenAI SDK directly, switching providers or adding mock support requires modifying the agent loop code — violating the open/closed principle and making CI dependent on a live API key.

Each provider has a different SDK surface (`anthropic.messages.create` vs `openai.chat.completions.create`), different error types, and different prompt formats. These differences must not leak into the agent loop.

---

## Decision

Define `LlmClient` as an interface in `@aegis/shared/src/types.ts`:

```typescript
interface LlmClient {
  decide(input: DecisionContext): Promise<LlmDecision>;
}
```

Provide three concrete implementations in `packages/agent/src/clients/llm-client.ts`:

- `AnthropicClient` — wraps `@anthropic-ai/sdk`; uses `claude-sonnet-4-6` by default (`ANTHROPIC_MODEL`).
- `OpenAiClient` — wraps `openai`; uses `gpt-4o` by default (`OPENAI_MODEL`).
- `MockLlmClient` — returns a deterministic allocation at 80% confidence; no network call; used in CI and when no API key is present.

The active implementation is selected in `packages/agent/src/run.ts` based on `LLM_PROVIDER` env var and the presence of the matching API key. The `AgentLoop` constructor receives an `LlmClient` instance — it never imports a concrete SDK.

Provider selection logic (in `run.ts`):
- `LLM_PROVIDER=anthropic` (default) + `ANTHROPIC_API_KEY` present → `AnthropicClient`
- `LLM_PROVIDER=openai` + `OPENAI_API_KEY` present → `OpenAiClient`
- No matching API key → `MockLlmClient` (logged as a warning, not an error)

---

## Consequences

**Positive:**
- The agent loop is entirely decoupled from provider SDKs; `AgentLoop` depends on an interface, not a concrete class.
- CI runs without any LLM API key via `MockLlmClient`.
- Swapping from Anthropic to OpenAI requires only setting `LLM_PROVIDER=openai` and `OPENAI_API_KEY` — no code changes.
- Adding a new provider (e.g., Google Gemini, a local Ollama model) requires only implementing `LlmClient` and adding a branch in `run.ts`.
- `MockLlmClient` produces predictable output for deterministic test assertions.

**Negative / trade-offs:**
- The `decide` method signature must be stable across providers. Any provider-specific capability (streaming, tool use, image input) that is not expressible via `DecisionContext` / `LlmDecision` cannot be accessed through this interface.
- Prompt engineering differs per provider. Both `AnthropicClient` and `OpenAiClient` wrap the same `buildDecisionPrompt()` output but submit it via their respective APIs — maintaining consistent structured-output behaviour across providers is not guaranteed and should be validated if switching providers in production.
