"use client";

import { useState, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { WalletContext } from "./WalletContext";
import type { WalletConnector, WalletState } from "./WalletContext";
import { mockConnector } from "./mockConnector";
import { selectWalletConnector } from "./selectConnector";

interface Props {
  children: ReactNode;
  nonce?: string;
}

export function WalletProvider({ children }: Props) {
  const [connector, setConnector] = useState<WalletConnector>(mockConnector);
  const [state, setState] = useState<WalletState>({ status: "disconnected" });

  // Resolve connector on the client after mount (never at SSR module scope).
  useEffect(() => {
    setConnector(selectWalletConnector());
  }, []);

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
  }, [connector]);

  const disconnect = useCallback(async () => {
    await connector.disconnect();
    setState({ status: "disconnected" });
  }, [connector]);

  const signAndDeploy = useCallback(
    async (deployJson: unknown): Promise<string> => {
      if (state.status !== "connected") {
        throw new Error("Wallet not connected");
      }
      return connector.signAndDeploy(deployJson);
    },
    [connector, state]
  );

  return (
    <WalletContext.Provider value={{ state, connect, disconnect, signAndDeploy }}>
      {children}
    </WalletContext.Provider>
  );
}
