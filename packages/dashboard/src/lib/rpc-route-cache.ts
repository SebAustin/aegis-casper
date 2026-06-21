/**
 * In-process RPC response cache for dashboard API routes.
 * Prevents parallel pollers from each hammering CSPR.cloud on 429.
 */

import {
  createCasperRpcClient,
  type CasperRpcDictionaryReader,
} from "@aegis/shared";

const CACHE_TTL_MS = 45_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

let rpcClient: CasperRpcDictionaryReader | null = null;
let rpcClientKey = "";

export async function getSharedRpcClient(
  nodeRpcUrl: string,
  apiKey: string
): Promise<CasperRpcDictionaryReader> {
  const key = `${nodeRpcUrl}:${apiKey}`;
  if (rpcClient && rpcClientKey === key) return rpcClient;
  rpcClient = await createCasperRpcClient({
    nodeRpcUrl,
    apiKey: apiKey || undefined,
  });
  rpcClientKey = key;
  return rpcClient;
}

export function getRouteCache<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.value as T;
  }
  cache.delete(key);
  return undefined;
}

export function setRouteCache<T>(key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}
