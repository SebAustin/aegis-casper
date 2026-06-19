/**
 * casper-tx.ts — builds REAL Casper 2.0 contract-call Transactions for the
 * vault deposit / withdraw flows (SC-02).
 *
 * The dashboard never holds a private key: it constructs an *unsigned*
 * Transaction (initiator = the connected wallet's public key) and serializes it
 * to the JSON shape that the CSPR.click connector's `send()` expects. The wallet
 * extension performs the signature and CSPR.click broadcasts it.
 *
 * Money flow:
 *   - deposit: a payable contract call with `amount` motes attached to the call
 *     (the vault's `#[odra(payable)] deposit` captures the attached value).
 *   - withdraw: a contract call to `withdraw(shares: U256)` (no value attached).
 */

import {
  ContractCallBuilder,
  PublicKey,
  CLValue,
  Args,
  type Transaction,
} from "casper-js-sdk";

const CONTRACT_CALL_PAYMENT_MOTES = 5_000_000_000; // 5 CSPR gas ceiling.
const SHARE_DECIMALS = 9; // AEGIS share token decimals (Cep18 init in vault).

/** The serialized transaction the wallet connector signs + broadcasts. */
export interface PreparedTransaction {
  /** casper-js-sdk Transaction JSON (`Transaction.toJSON()`). */
  transactionJson: unknown;
  /** Hex public key of the initiator (passed to CSPR.click `send`). */
  senderPublicKeyHex: string;
}

export interface BuildTxParams {
  /** Connected wallet account public key, hex. */
  senderPublicKeyHex: string;
  /** Vault contract hash (hex, optionally prefixed). */
  vaultContractHash: string;
  /** Casper network / chain name, e.g. `casper-test`. */
  network: string;
}

/**
 * Convert a human-unit amount to base units (bigint) at `decimals` precision.
 * Uses `toFixed` to avoid scientific notation (e.g. `1e-9`) and float drift.
 */
function toBaseUnits(amount: number, decimals: number): bigint {
  const fixed = amount.toFixed(decimals); // never scientific, exactly `decimals` frac digits
  const parts = fixed.split(".");
  const whole = parts[0] ?? "0";
  const frac = parts[1] ?? "";
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const sign = whole.startsWith("-") ? -1n : 1n;
  const wholeAbs = whole.replace("-", "") || "0";
  return (
    sign *
    (BigInt(wholeAbs) * 10n ** BigInt(decimals) + BigInt(fracPadded || "0"))
  );
}

/** Convert a CSPR amount (human units) to motes (bigint). */
export function csprToMotes(amountCspr: number): bigint {
  return toBaseUnits(amountCspr, 9);
}

/** Convert an AEGIS share amount (human units) to base units (bigint). */
export function sharesToBaseUnits(amountShares: number): bigint {
  return toBaseUnits(amountShares, SHARE_DECIMALS);
}

function normalizeContractHash(hash: string): string {
  return hash.replace(/^(hash-|contract-|package-)/, "");
}

function buildContractCall(
  params: BuildTxParams,
  entryPoint: string,
  args: Args
): Transaction {
  if (!params.vaultContractHash) {
    throw new Error("Vault contract hash is not configured.");
  }
  const sender = PublicKey.fromHex(params.senderPublicKeyHex);
  return new ContractCallBuilder()
    .from(sender)
    .byHash(normalizeContractHash(params.vaultContractHash))
    .entryPoint(entryPoint)
    .runtimeArgs(args)
    .chainName(params.network)
    .payment(CONTRACT_CALL_PAYMENT_MOTES)
    .build();
}

/**
 * Build a `deposit` transaction with `amount` motes attached (FR-D-05).
 *
 * The vault's payable `deposit` reads the attached value; we pass it as the
 * `amount` runtime arg (U512 motes), which Odra's payable prelude consumes.
 */
export function buildDepositTransaction(
  params: BuildTxParams,
  amountCspr: number
): PreparedTransaction {
  const motes = csprToMotes(amountCspr);
  if (motes <= 0n) {
    throw new Error("Deposit amount must be greater than zero.");
  }
  const args = Args.fromMap({
    amount: CLValue.newCLUInt512(motes.toString()),
  });
  const tx = buildContractCall(params, "deposit", args);
  return {
    transactionJson: tx.toJSON(),
    senderPublicKeyHex: params.senderPublicKeyHex,
  };
}

/**
 * Build a `withdraw(shares)` transaction (FR-W-01).
 */
export function buildWithdrawTransaction(
  params: BuildTxParams,
  amountShares: number
): PreparedTransaction {
  const shares = sharesToBaseUnits(amountShares);
  if (shares <= 0n) {
    throw new Error("Withdraw amount must be greater than zero.");
  }
  const args = Args.fromMap({
    shares: CLValue.newCLUInt256(shares.toString()),
  });
  const tx = buildContractCall(params, "withdraw", args);
  return {
    transactionJson: tx.toJSON(),
    senderPublicKeyHex: params.senderPublicKeyHex,
  };
}

/**
 * Build the deposit or withdraw transaction based on `mode`.
 */
export function buildVaultTransaction(
  mode: "deposit" | "withdraw",
  params: BuildTxParams,
  amount: number
): PreparedTransaction {
  return mode === "deposit"
    ? buildDepositTransaction(params, amount)
    : buildWithdrawTransaction(params, amount);
}
