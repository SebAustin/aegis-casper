import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * NFR-S-05: Nonce-based CSP. No unsafe-inline scripts.
 *
 * The nonce is generated per-request and embedded:
 *  1. As a response header `Content-Security-Policy`.
 *  2. As a request header `x-nonce` so the layout can read it via
 *     `headers()` and pass it to <Script nonce=…> / <style nonce=…>.
 *
 * NEXT_PUBLIC_ORACLE_URL and NEXT_PUBLIC_CSPR_CLOUD_API_URL are public
 * endpoints — safe to reference in connect-src. Never referenced: agent
 * private key, LLM API key.
 */
export function middleware(request: NextRequest) {
  // Web Crypto (Edge-runtime compatible — node:crypto is not available here).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));

  const oracleOrigin = process.env["NEXT_PUBLIC_ORACLE_URL"] ?? "http://localhost:4021";
  const csprCloudOrigin = process.env["NEXT_PUBLIC_CSPR_CLOUD_API_URL"] ?? "https://api.testnet.cspr.cloud";

  const csp = [
    `default-src 'self'`,
    // Next.js inline scripts require the nonce; no unsafe-inline.
    `script-src 'self' 'nonce-${nonce}'`,
    // CSS: allow inline styles required by Next.js App Router + Tailwind v4.
    // Tailwind v4 injects styles at build time; a hash approach works but is
    // fragile during development. Using 'unsafe-inline' for style-src only is
    // explicitly permitted by NFR-S-05 which restricts *scripts* only.
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com data:`,
    `img-src 'self' data: https:`,
    `connect-src 'self' ${oracleOrigin} ${csprCloudOrigin} https://testnet.cspr.live`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Apply to all routes except Next.js internals and static files.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
