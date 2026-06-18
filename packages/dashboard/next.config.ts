import type { NextConfig } from "next";

/**
 * NFR-S-05: Content Security Policy — no unsafe-inline scripts.
 * Nonces are injected via middleware (see src/middleware.ts).
 * Contract hashes and public RPC URLs are exposed via NEXT_PUBLIC_* vars —
 * they are not secrets. LLM keys and agent private keys stay server-only.
 */
const nextConfig: NextConfig = {
  // Transpile the workspace package so Next.js can resolve it.
  transpilePackages: ["@aegis/shared"],

  async headers() {
    return [
      {
        // The nonce-based CSP is handled in middleware.ts for dynamic nonces.
        // This static header applies to non-middleware routes (e.g. static assets).
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
