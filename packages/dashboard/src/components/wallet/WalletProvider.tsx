"use client";

import { useState, useCallback } from "react";
import type { ReactNode } from "react";
import { WalletContext } from "./WalletContext";
import type { WalletState } from "./WalletContext";
import { mockConnector } from "./mockConnector";

// To swap in the real CSPR.click SDK, replace `mockConnector` here.
// See mockConnector.ts for detailed instructions (A-WALLET-01).
const connector = mockConnector;

interface Props {
  children: ReactNode;
  nonce?: string;
}

export function WalletProvider({ children }: Props) {
  const [state, setState] = useState<WalletState>({ status: "disconnected" });

  const connect = useCallback(async () => {
    setState({ status: "connecting" });
    try {
      const accountHash = await connector.connect();
      const balanceMotes = await connector.getBalance(accountHash);
      setState({ status: "connected", accountHash, balanceMotes });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Connection declined. Check that Casper Wallet is unlocked.";
      setState({ status: "error", message });
    }
  }, []);

  const disconnect = useCallback(async () => {
    await connector.disconnect();
    setState({ status: "disconnected" });
  }, []);

  const signAndDeploy = useCallback(
    async (deployJson: unknown): Promise<string> => {
      if (state.status !== "connected") {
        throw new Error("Wallet not connected");
      }
      return connector.signAndDeploy(deployJson);
    },
    [state]
  );

  return (
    <WalletContext.Provider value={{ state, connect, disconnect, signAndDeploy }}>
      {children}
    </WalletContext.Provider>
  );
}
