/**
 * Mock wallet connector — explicit headless / CI fallback (SC-09).
 *
 * The REAL connector (`csprClickConnector`) is the browser default and is
 * already wired in `WalletProvider.tsx`. This mock is selected only when
 * `NEXT_PUBLIC_USE_MOCK_WALLET=true` or when there is no `window`
 * (server-side render / non-browser environments such as CI), so the full UI
 * flow (connecting → connected → deposit → sign → submitted) stays demoable
 * without the Casper Wallet extension or a live chain.
 *
 * It consumes the SAME `PreparedTransaction` payload the real connector and
 * `lib/casper-tx.ts` produce, so swapping connectors needs zero UI changes.
 * Only the signature + broadcast are simulated here.
 */

import type { WalletConnector } from "./WalletContext";

// A syntactically valid ED25519 public key hex (algorithm byte `01` + 32 bytes).
// Using a real public-key shape lets the deposit/withdraw transaction builder
// (lib/casper-tx.ts) construct a genuine, serializable Transaction even in the
// headless mock path — only the signature/broadcast is simulated.
const MOCK_ACCOUNT_HASH =
  "01896d214e81a8b87174e05824d15b9d5dcd70e99bece4df1b2c609c9210ee7ea8";
const MOCK_BALANCE_MOTES = BigInt("1250000000000"); // 1,250 CSPR

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const mockConnector: WalletConnector = {
  async connect() {
    await delay(400);
    return MOCK_ACCOUNT_HASH;
  },

  async disconnect() {
    await delay(100);
  },

  async getBalance(_accountHash: string) {
    await delay(150);
    return MOCK_BALANCE_MOTES;
  },

  async signAndDeploy(prepared: unknown) {
    // Validate the payload shape the real connector also requires, so the mock
    // path exercises the same contract (a real PreparedTransaction with a
    // serialized transactionJson) rather than accepting anything.
    const payload = prepared as { transactionJson?: unknown } | null;
    if (!payload || payload.transactionJson === undefined) {
      throw new Error("signAndDeploy: missing transactionJson in payload.");
    }
    await delay(2_000); // Simulate wallet popup + user confirmation.
    // Return a plausible-looking deploy hash (mock broadcast only).
    const hex = Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join("");
    return hex;
  },
};
