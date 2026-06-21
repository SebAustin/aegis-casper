/**
 * CSPR.cloud HTTP helpers.
 *
 * Access tokens go in the `Authorization` header as the raw token value —
 * not `Bearer <token>`. See https://docs.cspr.cloud/documentation/overview/authorization
 */

/** Build headers for CSPR.cloud REST or proxied node RPC calls. */
export function csprCloudAuthHeaders(
  apiKey: string | undefined
): Record<string, string> {
  if (!apiKey || apiKey.startsWith("replace-with")) {
    return {};
  }
  return { Authorization: apiKey };
}

/** Strip `hash-` / `contract-` / `package-` prefixes for REST path segments. */
export function stripHashPrefix(hash: string): string {
  return hash.replace(/^(hash-|contract-|package-)/, "");
}

/** Global-state / RPC key form (`hash-<64 hex>`). */
export function toContractStateKey(hash: string): string {
  const bare = stripHashPrefix(hash);
  return bare.startsWith("hash-") ? bare : `hash-${bare}`;
}
