/**
 * Retry helpers for CSPR.cloud node RPC rate limits (HTTP 429).
 */

export type RpcReadPolicy = "retry" | "fast-fail";

export function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("429") || message.includes("Code: 429");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry with exponential backoff. Uses longer delays when the error is a 429.
 */
export async function withRpcRetry<T>(
  fn: () => Promise<T>,
  options?: { delaysMs?: number[]; rateLimitDelaysMs?: number[] }
): Promise<T> {
  const delays = options?.delaysMs ?? [1_000, 3_000, 8_000];
  const rateLimitDelays = options?.rateLimitDelaysMs ?? [5_000, 15_000, 30_000];
  let lastError: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= delays.length) break;
      const delay = isRateLimitError(err)
        ? rateLimitDelays[attempt] ?? rateLimitDelays.at(-1)!
        : delays[attempt]!;
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Dispatch an RPC read with the selected policy.
 * `fast-fail`: no retry on 429; one 500ms retry for transient errors.
 */
export async function withRpcCall<T>(
  fn: () => Promise<T>,
  policy: RpcReadPolicy = "retry"
): Promise<T> {
  if (policy === "retry") {
    return withRpcRetry(fn);
  }

  try {
    return await fn();
  } catch (err) {
    if (isRateLimitError(err)) throw err;
    await sleep(500);
    return await fn();
  }
}
