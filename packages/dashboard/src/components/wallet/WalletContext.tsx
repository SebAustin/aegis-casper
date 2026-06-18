"use client";

import { createContext, useContext } from "react";

/**
 * WalletProvider interface.
 *
 * ASSUMPTIONS (A-WALLET-01):
 *   @make-software/cspr-click requires a browser-extension-based signing
 *   flow. The SDK is available on npm but injects wallet-specific globals.
 *   To keep the dashboard buildable and demoable without the Casper Wallet
 *   extension installed in CI/CD, a mock connector is the default
 *   implementation. The real SDK swaps in by replacing `mockConnector` in
 *   WalletProvider.tsx with `cspr-click`'s `CsprClickConnector`.
 *
 *   The interface contract below ensures zero UI changes when the real SDK
 *   is wired in — only the connector implementation changes.
 */

export type WalletState =
  | { status: "disconnected" }
  | { status: "connecting" }
  | { status: "connected"; accountHash: string; balanceMotes: bigint }
  | { status: "error"; message: string };

export interface WalletConnector {
  /**
   * Initiate wallet connection. Resolves to the connected account hash.
   * Rejects with an error message string on failure.
   */
  connect(): Promise<string>;

  /** Disconnect and clear session. */
  disconnect(): Promise<void>;

  /**
   * Request the user's CSPR balance from CSPR.cloud.
   * Returns balance in motes.
   */
  getBalance(accountHash: string): Promise<bigint>;

  /**
   * Sign and submit a deploy.
   * Returns the deploy hash.
   */
  signAndDeploy(deployJson: unknown): Promise<string>;
}

export interface WalletContextValue {
  state: WalletState;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signAndDeploy: (deployJson: unknown) => Promise<string>;
}

export const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
