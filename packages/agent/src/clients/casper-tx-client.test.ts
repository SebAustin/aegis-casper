/**
 * CasperTxClient builder tests (SC-03, SC-06).
 *
 * These assert the agent's transaction-construction logic is REAL, not a stub:
 *   - the built Transaction carries the correct contract entry point,
 *   - the runtime args are serialized as proper CLValues with the right names,
 *   - the contract hash targets the configured vault / registry,
 *   - the transaction is actually signed (gains an Approval),
 *   - submit returns the hash the (mock) RPC reports — never a random stub.
 *
 * We use the REAL casper-js-sdk to build/serialize/sign (so this exercises the
 * production code path), but inject a MOCK RpcClient so no network call occurs.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  CasperTxClient,
  buildReallocateTx,
  buildUpdateReputationTx,
  type CasperSdk,
  type SdkTransaction,
  type SdkPublicKey,
} from "./casper-tx-client.js";
import type { AllocationMap } from "@aegis/shared";

// Load the real SDK once, normalizing the ESM `.default` interop (see loader).
let sdk: CasperSdk;
let signingKeyHex: string;
let agentPublicKeyHex: string;
let agentPublicKey: SdkPublicKey;

beforeAll(async () => {
  const mod = (await import("casper-js-sdk")) as unknown as
    | CasperSdk
    | { default: CasperSdk };
  sdk = "default" in mod && mod.default ? mod.default : (mod as CasperSdk);

  // Generate a throwaway ED25519 keypair for hermetic signing (never a real key).
  const sdkAny = sdk as unknown as {
    PrivateKey: {
      generate(alg: number): { toBytes(): Uint8Array; publicKey: SdkPublicKey };
    };
    KeyAlgorithm: { ED25519: number };
  };
  const generated = sdkAny.PrivateKey.generate(sdk.KeyAlgorithm.ED25519);
  signingKeyHex = Buffer.from(generated.toBytes()).toString("hex");
  agentPublicKey = generated.publicKey;
  agentPublicKeyHex = generated.publicKey.toHex();
});

const VAULT_HASH = "a".repeat(64);
const REGISTRY_HASH = "b".repeat(64);
const AGENT_ACCOUNT_HASH = "account-hash-" + "c".repeat(64);
const NETWORK = "casper-test";

const ALLOCATION: AllocationMap = [
  { assetId: 0, bps: 4000 },
  { assetId: 1, bps: 3000 },
  { assetId: 2, bps: 3000 },
];

/** A mock RPC client that records the submitted tx and returns a deterministic hash. */
function makeMockRpc() {
  const calls: SdkTransaction[] = [];
  const REPORTED_HASH = "deadbeef".repeat(8); // 64 hex chars
  const factory = () => ({
    putTransaction: async (tx: SdkTransaction) => {
      calls.push(tx);
      return { transactionHash: { toHex: () => REPORTED_HASH } };
    },
  });
  return { calls, REPORTED_HASH, factory };
}

function makeClient(mockRpcFactory: () => { putTransaction: (tx: SdkTransaction) => Promise<{ transactionHash: { toHex(): string } }> }) {
  return new CasperTxClient(
    {
      privateKeyHex: signingKeyHex,
      keyAlgorithm: "ed25519",
      accountHash: AGENT_ACCOUNT_HASH,
      nodeRpcUrl: "http://localhost:7777/rpc",
      network: NETWORK,
      vaultContractHash: VAULT_HASH,
      registryContractHash: REGISTRY_HASH,
    },
    async () => sdk, // inject the real SDK
    () => mockRpcFactory() // inject the mock RPC client (no network)
  );
}

describe("buildReallocateTx", () => {
  it("builds a contract-call tx with the `reallocate` entry point", () => {
    const tx = buildReallocateTx(sdk, VAULT_HASH, NETWORK, ALLOCATION, agentPublicKey);
    expect(tx.entryPoint.customEntryPoint).toBe("reallocate");
  });

  it("targets the configured vault package by hash", () => {
    const tx = buildReallocateTx(sdk, VAULT_HASH, NETWORK, ALLOCATION, agentPublicKey);
    const hashBytes = tx.target.stored?.id?.byPackageHash?.addr?.hashBytes;
    expect(Buffer.from(hashBytes!).toString("hex")).toBe(VAULT_HASH);
  });

  it("serializes the allocation as a single `allocation` runtime arg", () => {
    const tx = buildReallocateTx(sdk, VAULT_HASH, NETWORK, ALLOCATION, agentPublicKey);
    const keys = [...tx.args.args.keys()];
    expect(keys).toEqual(["allocation"]);
    // The arg must be a non-null CLValue (List<Tuple2<U8,U32>>), not a stub.
    const allocationArg = tx.args.args.get("allocation");
    expect(allocationArg).toBeDefined();
    expect(typeof allocationArg!.getType).toBe("function");
  });
});

describe("buildUpdateReputationTx", () => {
  it("builds a contract-call tx with the `update_reputation` entry point", () => {
    const tx = buildUpdateReputationTx(
      sdk,
      REGISTRY_HASH,
      NETWORK,
      AGENT_ACCOUNT_HASH,
      -3,
      Buffer.alloc(32, 7),
      agentPublicKey
    );
    expect(tx.entryPoint.customEntryPoint).toBe("update_reputation");
  });

  it("serializes agent, delta and rationale_hash as named CLValues", () => {
    const tx = buildUpdateReputationTx(
      sdk,
      REGISTRY_HASH,
      NETWORK,
      AGENT_ACCOUNT_HASH,
      5,
      Buffer.alloc(32, 9),
      agentPublicKey
    );
    const keys = [...tx.args.args.keys()].sort();
    expect(keys).toEqual(["agent", "delta", "rationale_hash"]);
    const hashBytes = tx.target.stored?.id?.byPackageHash?.addr?.hashBytes;
    expect(Buffer.from(hashBytes!).toString("hex")).toBe(REGISTRY_HASH);
  });
});

describe("CasperTxClient.submitReallocate", () => {
  it("signs the tx and returns the hash the RPC reports (not a random stub)", async () => {
    const mock = makeMockRpc();
    const client = makeClient(mock.factory);

    const result = await client.submitReallocate(ALLOCATION);

    // The hash is exactly what the mock RPC returned — proves it is not a stub.
    expect(result.txHash).toBe(mock.REPORTED_HASH);

    // Exactly one tx was submitted, carrying the right entry point and a real signature.
    expect(mock.calls).toHaveLength(1);
    const submitted = mock.calls[0]! as unknown as {
      entryPoint: { customEntryPoint?: string };
      approvals: unknown[];
    };
    expect(submitted.entryPoint.customEntryPoint).toBe("reallocate");
    expect(submitted.approvals.length).toBe(1); // signed
  });
});

describe("CasperTxClient.submitUpdateReputation", () => {
  it("signs and submits an update_reputation tx, returning the RPC hash", async () => {
    const mock = makeMockRpc();
    const client = makeClient(mock.factory);

    const result = await client.submitUpdateReputation(
      AGENT_ACCOUNT_HASH,
      -1,
      Buffer.alloc(32, 1)
    );

    expect(result.txHash).toBe(mock.REPORTED_HASH);
    expect(mock.calls).toHaveLength(1);
    const submitted = mock.calls[0]! as unknown as {
      entryPoint: { customEntryPoint?: string };
      approvals: unknown[];
      args: { args: Map<string, unknown> };
    };
    expect(submitted.entryPoint.customEntryPoint).toBe("update_reputation");
    expect([...submitted.args.args.keys()].sort()).toEqual([
      "agent",
      "delta",
      "rationale_hash",
    ]);
    expect(submitted.approvals.length).toBe(1);
  });

  it("rejects a rationale hash that is not 32 bytes", async () => {
    const mock = makeMockRpc();
    const client = makeClient(mock.factory);
    await expect(
      client.submitUpdateReputation(AGENT_ACCOUNT_HASH, 1, Buffer.alloc(16, 0))
    ).rejects.toThrow(/32 bytes/);
  });

  it("uses the agent public key as the transaction initiator", async () => {
    const mock = makeMockRpc();
    const client = makeClient(mock.factory);
    await client.submitUpdateReputation(AGENT_ACCOUNT_HASH, 1, Buffer.alloc(32, 2));
    const submitted = mock.calls[0]! as unknown as {
      initiatorAddr: { publicKey?: { toHex(): string } };
    };
    expect(submitted.initiatorAddr.publicKey?.toHex()).toBe(agentPublicKeyHex);
  });
});
