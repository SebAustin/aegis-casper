import type { WalletConnector } from "./WalletContext";
import { mockConnector } from "./mockConnector";
import { csprClickConnector } from "./csprClickConnector";

interface ClickRuntime {
  connect?(provider: string): Promise<unknown>;
  getActivePublicKey?(): Promise<string>;
}

/**
 * Whether the hosted CSPR.click runtime is present (not just a browser stub).
 * Casper Wallet extensions may inject a partial global that hangs on connect.
 */
export function isCsprClickReady(): boolean {
  if (typeof window === "undefined") return false;
  const runtime = (window as unknown as { csprclick?: ClickRuntime }).csprclick;
  if (!runtime) return false;
  return (
    typeof runtime.connect === "function" &&
    typeof runtime.getActivePublicKey === "function"
  );
}

/**
 * Pick wallet connector for the browser.
 *
 * Local dev defaults to the mock wallet unless
 * `NEXT_PUBLIC_USE_MOCK_WALLET=false` is set explicitly.
 */
export function selectWalletConnector(): WalletConnector {
  const flag = process.env["NEXT_PUBLIC_USE_MOCK_WALLET"];
  const forceMock =
    flag === "true" ||
    (flag !== "false" && process.env.NODE_ENV === "development");

  if (forceMock) {
    return mockConnector;
  }

  if (isCsprClickReady()) {
    return csprClickConnector;
  }

  return mockConnector;
}
