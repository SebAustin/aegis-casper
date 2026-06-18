/**
 * Mock wallet connector for development / CI demo.
 *
 * ASSUMPTIONS (A-WALLET-01): @make-software/cspr-click is not installed as
 * a default dependency because it requires a browser extension at runtime
 * and adds bundle weight that breaks NFR-P-02 (< 300 KB gzipped) in
 * environments where the extension is not available.
 *
 * To wire in the real CSPR.click SDK:
 *   1. `pnpm --filter @aegis/dashboard add @make-software/cspr-click`
 *   2. Replace this file with a CsprClickConnector implementation that
 *      delegates to `CsprClickInitiator.connect()` and
 *      `CsprClickSigner.sign()` from the SDK.
 *   3. Update WalletProvider.tsx to import the real connector.
 *
 * The mock simulates realistic latency and state transitions so the full
 * UI flow (connecting → connected → deposit → sign → submitted) is
 * demoable without a live chain.
 */

import type { WalletConnector } from "./WalletContext";

const MOCK_ACCOUNT_HASH =
  "account-hash-4f2d3b1c0e9a8765432100fedcba987654321abcdef0123456789abcdef012345";
const MOCK_BALANCE_MOTES = BigInt("1250000000000"); // 1,250 CSPR

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const mockConnector: WalletConnector = {
  async connect() {
    await delay(1_200); // Simulate extension handshake.
    return MOCK_ACCOUNT_HASH;
  },

  async disconnect() {
    await delay(200);
  },

  async getBalance(_accountHash: string) {
    await delay(400);
    return MOCK_BALANCE_MOTES;
  },

  async signAndDeploy(_deployJson: unknown) {
    await delay(2_000); // Simulate wallet popup + user confirmation.
    // Return a plausible-looking deploy hash.
    const hex = Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join("");
    return hex;
  },
};
