/**
 * Demo mode gate.
 *
 * `NEXT_PUBLIC_DEMO_MODE=true` is set on the hosted (Vercel) deploy where no
 * agent process is running and there is no `logs/decisions.jsonl` on disk.
 * Reading it via `process.env.NEXT_PUBLIC_DEMO_MODE` (rather than
 * destructuring) keeps it statically replaceable by Next.js in client
 * bundles while remaining a normal runtime env read in server code (API
 * routes, route handlers).
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}
