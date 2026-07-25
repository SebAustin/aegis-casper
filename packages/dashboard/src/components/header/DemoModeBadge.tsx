/**
 * Small "DEMO" indicator shown next to Trigger Agent Run when
 * `NEXT_PUBLIC_DEMO_MODE=true` (hosted/serverless deploy — no live agent
 * process is reachable). Honest framing: this is a simulated agent, not an
 * on-chain submission.
 *
 * Server Component by default — `process.env.NEXT_PUBLIC_DEMO_MODE` is
 * inlined at build time for the client bundle too, so this reads correctly
 * whether rendered on the server or hydrated on the client.
 */
export function DemoModeBadge() {
  if (process.env["NEXT_PUBLIC_DEMO_MODE"] !== "true") {
    return null;
  }

  return (
    <span
      title="Demo mode — simulated agent decisions. The live agent runs locally against Casper Testnet."
      aria-label="Demo mode — simulated agent decisions. The live agent runs locally against Casper Testnet."
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: "24px",
        padding: "0 var(--space-2)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--color-accent-gold)",
        color: "var(--color-accent-gold)",
        background: "var(--color-accent-gold-10, rgba(212, 175, 55, 0.1))",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-medium)",
        letterSpacing: "var(--tracking-wide)",
        cursor: "help",
      }}
    >
      DEMO
    </span>
  );
}
