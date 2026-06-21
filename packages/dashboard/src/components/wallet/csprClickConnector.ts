/**
 * csprClickConnector.ts — REAL Casper Wallet connector via CSPR.click (SC-09).
 *
 * Implements `WalletConnector` against the CSPR.click runtime, which is the
 * `window.csprclick` global injected by the hosted CSPR.click runtime
 * (`@make-software/csprclick-core-client` provides the TypeScript surface and
 * the `Window.csprclick` global augmentation). It talks to the user's Casper
 * Wallet browser extension for connect + signing and broadcasts the deposit /
 * withdraw Transaction built in `lib/casper-tx.ts` (Defect 2).
 *
 * Runtime bootstrap note (A-WALLET-01): the `@make-software/csprclick-core-client`
 * npm package (v1.11.0) ships ONLY TypeScript declarations — its `index.js`
 * runtime is loaded from the CSPR.click host/CDN and is normally bootstrapped by
 * `@make-software/csprclick-ui`'s `<CsprClickProvider>`. That UI package hard-pins
 * React 18.3.1 and cannot be installed alongside this dashboard's React 19. We
 * therefore drive the runtime through the documented `window.csprclick` global:
 * this is the SAME real API (`connect` / `getActivePublicKey` / `send`) the React
 * provider uses internally. Wiring the bootstrap (loading the runtime script and
 * calling `init`) is the single gated step; the connector logic below is real and
 * correct against the real API.
 */

import type { WalletConnector } from "./WalletContext";
// Type-only import: pulls in the `Window.csprclick` global augmentation and the
// SDK types. No runtime code is imported (the package ships declarations only).
import type {} from "@make-software/csprclick-core-client";

const CASPER_WALLET_PROVIDER = "casper-wallet";

/** Narrow runtime view of the CSPR.click global we depend on. */
interface ClickRuntime {
  connect(provider: string): Promise<{ public_key?: string } | undefined>;
  disconnect(provider: string): Promise<void>;
  getActivePublicKey(): Promise<string>;
  send(
    deployJson: string | object,
    signingPublicKey: string,
    waitProcessing?: boolean,
    timeout?: number
  ): Promise<{
    cancelled: boolean;
    deployHash: string | null;
    transactionHash: string | null;
    error: string | null;
  } | undefined>;
}

let activePublicKeyHex: string | null = null;

/**
 * Resolve the CSPR.click runtime from the browser global. Throws a clear error
 * if the hosted runtime has not been bootstrapped (see module note).
 */
function getRuntime(): ClickRuntime {
  if (typeof window === "undefined") {
    throw new Error("CSPR.click is only available in the browser.");
  }
  const runtime = (window as unknown as { csprclick?: ClickRuntime }).csprclick;
  if (!runtime) {
    throw new Error(
      "CSPR.click runtime not initialized. Bootstrap the CSPR.click runtime " +
        "(or set NEXT_PUBLIC_USE_MOCK_WALLET=true for headless mode)."
    );
  }
  return runtime;
}

async function fetchBalanceMotes(accountIdentifier: string): Promise<bigint> {
  // Balance comes from CSPR.cloud. On any failure we surface 0 rather than
  // blocking the UI.
  try {
    const base =
      process.env["NEXT_PUBLIC_CSPR_CLOUD_API_URL"] ??
      "https://api.testnet.cspr.cloud";
    const res = await fetch(
      `${base}/accounts/${encodeURIComponent(accountIdentifier)}`,
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) return 0n;
    const data = (await res.json()) as { data?: { balance?: string } };
    return BigInt(data.data?.balance ?? "0");
  } catch {
    return 0n;
  }
}

export const csprClickConnector: WalletConnector = {
  async connect(): Promise<string> {
    const runtime = getRuntime();
    const CONNECT_TIMEOUT_MS = 20_000;

    const connectPromise = (async () => {
      const account = await runtime.connect(CASPER_WALLET_PROVIDER);
      const publicKeyHex =
        account?.public_key ?? (await runtime.getActivePublicKey());
      if (!publicKeyHex) {
        throw new Error("Casper Wallet did not return an account.");
      }
      activePublicKeyHex = publicKeyHex;
      return publicKeyHex;
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            "Wallet connection timed out. For local demo without Casper Wallet, " +
              "set NEXT_PUBLIC_USE_MOCK_WALLET=true in packages/dashboard/.env.local " +
              "and restart pnpm dev."
          )
        );
      }, CONNECT_TIMEOUT_MS);
    });

    return Promise.race([connectPromise, timeoutPromise]);
  },

  async disconnect(): Promise<void> {
    const runtime = (window as unknown as { csprclick?: ClickRuntime }).csprclick;
    if (!runtime) return;
    await runtime.disconnect(CASPER_WALLET_PROVIDER);
    activePublicKeyHex = null;
  },

  async getBalance(accountIdentifier: string): Promise<bigint> {
    return fetchBalanceMotes(accountIdentifier);
  },

  /**
   * Sign + broadcast a prepared deposit/withdraw Transaction.
   *
   * Accepts the `PreparedTransaction` produced by `lib/casper-tx.ts`:
   *   { transactionJson, senderPublicKeyHex }.
   * CSPR.click forwards the transaction to the wallet for signing, then
   * broadcasts it, returning the on-chain transaction hash.
   */
  async signAndDeploy(prepared: unknown): Promise<string> {
    const runtime = getRuntime();
    const payload = prepared as {
      transactionJson?: unknown;
      senderPublicKeyHex?: string;
    };
    const txJson = payload?.transactionJson;
    const signer =
      payload?.senderPublicKeyHex ??
      activePublicKeyHex ??
      (await runtime.getActivePublicKey());
    if (!txJson) {
      throw new Error("signAndDeploy: missing transactionJson in payload.");
    }
    if (!signer) {
      throw new Error("signAndDeploy: no active signing public key.");
    }

    const result = await runtime.send(txJson as object, signer);
    if (!result || result.cancelled) {
      throw new Error("Transaction was cancelled in the wallet.");
    }
    if (result.error) {
      throw new Error(result.error);
    }
    const hash = result.transactionHash ?? result.deployHash;
    if (!hash) {
      throw new Error("Wallet returned no transaction hash.");
    }
    return hash;
  },
};
