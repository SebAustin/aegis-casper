/**
 * Demo overlay for mock-wallet deposits / withdraws.
 *
 * The mock connector simulates sign+broadcast only — nothing lands on chain.
 * We persist session adjustments so the cockpit reflects the demo flow the user
 * expects when NEXT_PUBLIC_USE_MOCK_WALLET=true.
 */

const STORAGE_KEY = "aegis-mock-vault-overlay";
export const MOCK_VAULT_OVERLAY_EVENT = "aegis-mock-vault-overlay-changed";

export interface MockVaultOverlay {
  addedBalanceMotes: string;
  addedShares: string;
}

export function isMockWalletMode(): boolean {
  if (typeof window === "undefined") return false;
  const flag = process.env["NEXT_PUBLIC_USE_MOCK_WALLET"];
  return (
    flag === "true" ||
    (flag !== "false" && process.env.NODE_ENV === "development")
  );
}

function readOverlay(): MockVaultOverlay {
  if (typeof window === "undefined") {
    return { addedBalanceMotes: "0", addedShares: "0" };
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { addedBalanceMotes: "0", addedShares: "0" };
    const parsed = JSON.parse(raw) as MockVaultOverlay;
    return {
      addedBalanceMotes: parsed.addedBalanceMotes ?? "0",
      addedShares: parsed.addedShares ?? "0",
    };
  } catch {
    return { addedBalanceMotes: "0", addedShares: "0" };
  }
}

function writeOverlay(overlay: MockVaultOverlay): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(overlay));
  window.dispatchEvent(new Event(MOCK_VAULT_OVERLAY_EVENT));
}

export function getMockVaultOverlay(): {
  addedBalanceMotes: bigint;
  addedShares: bigint;
} {
  const o = readOverlay();
  return {
    addedBalanceMotes: BigInt(o.addedBalanceMotes || "0"),
    addedShares: BigInt(o.addedShares || "0"),
  };
}

/** Record a simulated deposit (CSPR human units). */
export function addMockDeposit(amountCspr: number): void {
  if (!isMockWalletMode()) return;
  const motes = BigInt(Math.round(amountCspr * 1e9));
  const shares = motes; // 1:1 on first deposit in an empty vault (demo simplification).
  const current = getMockVaultOverlay();
  writeOverlay({
    addedBalanceMotes: (current.addedBalanceMotes + motes).toString(),
    addedShares: (current.addedShares + shares).toString(),
  });
}

/** Record a simulated withdraw (AEGIS share human units). */
export function addMockWithdraw(amountShares: number): void {
  if (!isMockWalletMode()) return;
  const shareBase = BigInt(Math.round(amountShares * 1e9));
  const motes = shareBase;
  const current = getMockVaultOverlay();
  const nextShares =
    current.addedShares > shareBase
      ? current.addedShares - shareBase
      : 0n;
  const nextBalance =
    current.addedBalanceMotes > motes
      ? current.addedBalanceMotes - motes
      : 0n;
  writeOverlay({
    addedBalanceMotes: nextBalance.toString(),
    addedShares: nextShares.toString(),
  });
}
