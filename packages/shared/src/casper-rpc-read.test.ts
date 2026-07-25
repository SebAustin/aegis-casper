/**
 * Unit tests for the Odra 2.8 / Casper 2.0 state-dictionary read path.
 *
 * All fixtures are REAL bytes captured from the testnet registry/vault
 * (`state` dictionary), so these tests pin the exact key derivation and
 * decoding the live chain requires. Network is fully mocked.
 */

import { describe, expect, it } from "vitest";
import {
  odraDictionaryItemKey,
  odraIndexBytes,
  parseAgentProfileValue,
  parseAllocationValue,
  readReputationFromRpc,
  readVaultStateFromRpc,
  type CasperRpcDictionaryReader,
} from "./casper-rpc-read.js";

// Real testnet agent (== owner on testnet, A-016).
const AGENT = "account-hash-efb29af93cde23773f028f6acf44efcd2fe324eafeea5fe8f8efd7b55f810b76";
// Key::to_bytes() == [tag 0x00][32-byte hash] for an account address.
const AGENT_KEY_BYTES = Buffer.from(
  "00efb29af93cde23773f028f6acf44efcd2fe324eafeea5fe8f8efd7b55f810b76",
  "hex"
);
// Item key observed on-chain for Registry.profiles (field index 2) + agent key.
const REAL_PROFILE_ITEM_KEY =
  "12f58bdbcbaefccbc9e6627d9c46bfbd7adfbf35720a0d90c32d287034bf2f1c";

// Real CLValue List(U8) bytes for the stored AgentProfile.
// 20000000 (len 32) | 0e..(14) | 25..(37) | 01..(1) | ts
const PROFILE_BYTES =
  "200000000e0000000000000025000000000000000100000000000000271e98ea9e010000";
// Real vault allocation Vec<(u8,u32)>: 2500/1500/1500/2000/2500 bps.
const ALLOCATION_BYTES =
  "1d0000000500000000c409000001dc05000002dc05000003d007000004c4090000";
const AGENT_ADDR_BYTES = "2100000000efb29af93cde23773f028f6acf44efcd2fe324eafeea5fe8f8efd7b55f810b76";
const PAUSED_FALSE_BYTES = "0100000000";
const LAST_TS_BYTES = "08000000200004eb9e010000";

const STATE_UREF = "uref-d023fcc6c51d30657acc87ee6157c75e121bf1417409b6a333d343cac9b983b7-007";
const PKG = "hash-e1523b014cebc6baa1e4494423e53ae3794ccd790bf7c656df292dde19d865fe";
const CONTRACT_HASH = "contract-4610ce1e36414dd0f6ba1bd69120fe42ed8804a0fde1076510dcba0abf4a2296";

function clValue(bytesHex: string): Record<string, unknown> {
  return { CLValue: { cl_type: { List: "U8" }, bytes: bytesHex } };
}

/** Build a mock RPC that resolves the package → contract → state uref and
 *  answers dictionary reads from an itemKey → storedValue map. */
function makeMockRpc(
  dict: Record<string, Record<string, unknown>>
): CasperRpcDictionaryReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async queryLatestGlobalState(key: string) {
      calls.push(`gs:${key}`);
      if (key === PKG) {
        return {
          rawJSON: {
            stored_value: {
              ContractPackage: { versions: [{ contract_hash: CONTRACT_HASH }] },
            },
          },
        };
      }
      if (key === `hash-${CONTRACT_HASH.replace(/^contract-/, "")}`) {
        return {
          rawJSON: {
            stored_value: {
              Contract: { named_keys: [{ name: "state", key: STATE_UREF }] },
            },
          },
        };
      }
      return { rawJSON: { stored_value: {} } };
    },
    async queryLatestBalance() {
      return { balance: { toJSON: () => "0" } };
    },
    async getDictionaryItem(_srh: string | null, uref: string, itemKey: string) {
      calls.push(`dict:${itemKey}`);
      expect(uref).toBe(STATE_UREF);
      const found = dict[itemKey];
      if (!found) {
        throw new Error("Code: -32003, err: Query failed");
      }
      return { rawJSON: { stored_value: found } };
    },
  };
}

describe("odra key derivation", () => {
  it("packs field index 2 into a big-endian u32 (legacy encoding)", () => {
    expect(odraIndexBytes([2]).toString("hex")).toBe("00000002");
  });

  it("derives the real on-chain item key for profiles(idx 2) + agent key", () => {
    expect(odraDictionaryItemKey([2], AGENT_KEY_BYTES)).toBe(REAL_PROFILE_ITEM_KEY);
  });

  it("does NOT match the buggy 0-based index (idx 1)", () => {
    expect(odraDictionaryItemKey([1], AGENT_KEY_BYTES)).not.toBe(REAL_PROFILE_ITEM_KEY);
  });
});

describe("parseAgentProfileValue", () => {
  it("decodes 4x u64 LE from the CLValue List(U8) inner bytes", () => {
    const rep = parseAgentProfileValue(clValue(PROFILE_BYTES), AGENT);
    expect(rep).not.toBeNull();
    expect(rep!.score).toBe(14n);
    expect(rep!.totalDecisions).toBe(37n);
    expect(rep!.correctPredictions).toBe(1n);
    expect(rep!.registeredTs).toBeGreaterThan(1_700_000_000_000);
  });

  it("returns null for a malformed/short value", () => {
    expect(parseAgentProfileValue(clValue("0400000001020304"), AGENT)).toBeNull();
    expect(parseAgentProfileValue(undefined, AGENT)).toBeNull();
  });
});

describe("parseAllocationValue", () => {
  it("decodes Vec<(u8,u32)> summing to 10000 bps", () => {
    const alloc = parseAllocationValue(clValue(ALLOCATION_BYTES));
    expect(alloc).toEqual([
      { assetId: 0, bps: 2500 },
      { assetId: 1, bps: 1500 },
      { assetId: 2, bps: 1500 },
      { assetId: 3, bps: 2000 },
      { assetId: 4, bps: 2500 },
    ]);
    expect(alloc!.reduce((s, a) => s + a.bps, 0)).toBe(10000);
  });
});

describe("readReputationFromRpc", () => {
  it("returns the REAL on-chain profile (not the seed fallback)", async () => {
    const rpc = makeMockRpc({ [REAL_PROFILE_ITEM_KEY]: clValue(PROFILE_BYTES) });
    const rep = await readReputationFromRpc(rpc, PKG, AGENT, { readPolicy: "fast-fail" });
    expect(rep).not.toBeNull();
    expect(rep!.score).toBe(14n);
    expect(rep!.totalDecisions).toBe(37n);
    // Proves the corrected field index (2) item key was queried.
    expect(rpc.calls).toContain(`dict:${REAL_PROFILE_ITEM_KEY}`);
  });

  it("returns null (graceful) for an unregistered agent — QueryFailed", async () => {
    const rpc = makeMockRpc({}); // no dictionary entries → -32003
    const rep = await readReputationFromRpc(rpc, PKG, AGENT, { readPolicy: "fast-fail" });
    expect(rep).toBeNull();
  });

  it("propagates rate-limit errors so the client can flag them", async () => {
    const rpc = makeMockRpc({});
    rpc.getDictionaryItem = async () => {
      throw new Error("Code: 429, err: Too Many Requests");
    };
    await expect(
      readReputationFromRpc(rpc, PKG, AGENT, { readPolicy: "fast-fail" })
    ).rejects.toThrow("429");
  });
});

describe("readVaultStateFromRpc", () => {
  it("reads allocation / agent / paused / lastReallocationTs from the state dict", async () => {
    const empty = Buffer.alloc(0);
    const dict: Record<string, Record<string, unknown>> = {
      [odraDictionaryItemKey([5], empty)]: clValue(ALLOCATION_BYTES),
      [odraDictionaryItemKey([2], empty)]: clValue(AGENT_ADDR_BYTES),
      [odraDictionaryItemKey([4], empty)]: clValue(PAUSED_FALSE_BYTES),
      [odraDictionaryItemKey([6], empty)]: clValue(LAST_TS_BYTES),
    };
    // Reuse the registry mock resolver but point PKG resolution the same way.
    const rpc = makeMockRpc(dict);
    const state = await readVaultStateFromRpc(rpc, PKG, AGENT, { readPolicy: "fast-fail" });
    expect(state.allocation.reduce((s, a) => s + a.bps, 0)).toBe(10000);
    expect(state.allocation[0]).toEqual({ assetId: 0, bps: 2500 });
    expect(state.agentAccountHash).toBe(AGENT);
    expect(state.paused).toBe(false);
    expect(state.lastReallocationTs).toBeGreaterThan(1_700_000_000_000);
  });

  it("falls back to default allocation when state fields are absent", async () => {
    const rpc = makeMockRpc({}); // dict reads all -32003
    const state = await readVaultStateFromRpc(rpc, PKG, AGENT, { readPolicy: "fast-fail" });
    expect(state.allocation).toHaveLength(5);
    expect(state.allocation.reduce((s, a) => s + a.bps, 0)).toBe(10000);
    expect(state.paused).toBe(false);
  });
});
