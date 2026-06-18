/**
 * Provider-agnostic LLM client implementations (A-006).
 *
 * Exports:
 *   AnthropicClient  — uses @anthropic-ai/sdk (default)
 *   OpenAiClient     — uses openai SDK (swap via LLM_PROVIDER=openai)
 *   MockLlmClient    — deterministic output for tests and offline demo
 *
 * All implementations satisfy the LlmClient interface from @aegis/shared.
 */

import { llmDecisionSchema } from "@aegis/shared";
import type {
  LlmClient,
  LlmDecision,
  DecisionContext,
  AllocationMap,
} from "@aegis/shared";

// ── Prompt builder ────────────────────────────────────────────────────────────

export function buildDecisionPrompt(ctx: DecisionContext): string {
  const assets = ctx.oracleData.assets
    .map(
      (a) =>
        `  - ${a.name} (id=${a.assetId}): APY=${a.apyBps / 100}%, risk=${a.riskScore}/100, liquidity=${a.liquidityScore}/100`
    )
    .join("\n");

  const currentAlloc = ctx.vaultState.allocation
    .map((e) => `    assetId ${e.assetId}: ${e.bps} bps`)
    .join("\n");

  return `You are Aegis, an autonomous on-chain portfolio manager for Casper Network.
Your task is to decide the optimal allocation across 5 tokenized real-world-asset (RWA) slots.

## Current Vault State
- Total balance: ${(ctx.vaultState.totalBalanceMotes / BigInt(1_000_000_000)).toString()} CSPR
- Total shares: ${ctx.vaultState.totalShares.toString()}
- Paused: ${ctx.vaultState.paused}

## Current Allocation
${currentAlloc}

## Available RWA Assets
${assets}

## Agent Reputation
- Score: ${ctx.reputation.score.toString()}
- Total decisions: ${ctx.reputation.totalDecisions.toString()}
- Correct predictions: ${ctx.reputation.correctPredictions.toString()}

## Instructions
Analyse the RWA data and produce an optimal allocation. You MUST:
1. Include exactly 5 entries, one per assetId (0..4).
2. Ensure all bps weights sum to exactly 10,000.
3. Keep each individual asset weight ≤ 6,000 bps (60% maximum concentration).
4. Provide a confidence score (0–100) and a concise rationale (≤ 500 characters).

Respond with ONLY valid JSON in this exact format (no markdown code blocks):
{
  "allocation": [
    {"assetId": 0, "bps": <number>},
    {"assetId": 1, "bps": <number>},
    {"assetId": 2, "bps": <number>},
    {"assetId": 3, "bps": <number>},
    {"assetId": 4, "bps": <number>}
  ],
  "confidence": <0-100>,
  "rationale": "<string, max 500 chars>"
}`;
}

/** Parse the LLM response text → LlmDecision. Throws on Zod failure. */
function parseDecision(text: string): LlmDecision {
  // Strip markdown code fences if the model wraps the JSON
  const cleaned = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  const parsed = JSON.parse(cleaned) as unknown;
  return llmDecisionSchema.parse(parsed);
}

// ── AnthropicClient ───────────────────────────────────────────────────────────

export class AnthropicClient implements LlmClient {
  private client: import("@anthropic-ai/sdk").Anthropic | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  private async getClient(): Promise<import("@anthropic-ai/sdk").Anthropic> {
    if (!this.client) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      this.client = new Anthropic({ apiKey: this.apiKey });
    }
    return this.client;
  }

  async decide(ctx: DecisionContext): Promise<LlmDecision> {
    const prompt = buildDecisionPrompt(ctx);
    const client = await this.getClient();

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0];
    if (!content || content.type !== "text") {
      throw new Error("AnthropicClient: unexpected response format");
    }

    return parseDecision(content.text);
  }
}

// ── OpenAiClient ──────────────────────────────────────────────────────────────

export class OpenAiClient implements LlmClient {
  private client: import("openai").OpenAI | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  private async getClient(): Promise<import("openai").OpenAI> {
    if (!this.client) {
      const { default: OpenAI } = await import("openai");
      this.client = new OpenAI({ apiKey: this.apiKey });
    }
    return this.client;
  }

  async decide(ctx: DecisionContext): Promise<LlmDecision> {
    const prompt = buildDecisionPrompt(ctx);
    const client = await this.getClient();

    const response = await client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      response_format: { type: "json_object" },
    });

    const text = response.choices[0]?.message.content;
    if (!text) {
      throw new Error("OpenAiClient: empty response");
    }

    return parseDecision(text);
  }
}

// ── MockLlmClient (for tests / offline demo) ──────────────────────────────────

/**
 * Returns a deterministic allocation that always passes sanity checks.
 * Confidence is configurable so tests can exercise the confidence gate.
 */
export class MockLlmClient implements LlmClient {
  constructor(
    private readonly overrides: {
      confidence?: number;
      allocation?: AllocationMap;
      /** Set to truthy string to make the client throw */
      shouldThrow?: string;
      /** Return malformed JSON (for Zod rejection tests) */
      malformed?: boolean;
    } = {}
  ) {}

  async decide(_ctx: DecisionContext): Promise<LlmDecision> {
    if (this.overrides.shouldThrow) {
      throw new Error(this.overrides.shouldThrow);
    }

    if (this.overrides.malformed) {
      // Force Zod failure
      throw new SyntaxError("Unexpected token < in JSON at position 0");
    }

    const allocation: AllocationMap = this.overrides.allocation ?? [
      { assetId: 0, bps: 2000 },
      { assetId: 1, bps: 3000 },
      { assetId: 2, bps: 2000 },
      { assetId: 3, bps: 1500 },
      { assetId: 4, bps: 1500 },
    ];

    return {
      allocation,
      confidence: this.overrides.confidence ?? 80,
      rationale:
        "Mock allocation: private credit yields highest APY this epoch.",
    };
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create the appropriate LLM client from environment config.
 */
export function createLlmClient(env: {
  LLM_PROVIDER: "anthropic" | "openai";
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL: string;
}): LlmClient {
  if (env.LLM_PROVIDER === "openai") {
    if (!env.OPENAI_API_KEY) {
      throw new Error("LLM_PROVIDER=openai but OPENAI_API_KEY is not set");
    }
    return new OpenAiClient(env.OPENAI_API_KEY, env.OPENAI_MODEL);
  }

  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      "LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set. " +
        "Set ANTHROPIC_API_KEY or use MockLlmClient for offline testing."
    );
  }
  return new AnthropicClient(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
}
