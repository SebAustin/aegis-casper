import { describe, expect, it, vi } from "vitest";
import { isRateLimitError, withRpcCall } from "./casper-rpc-retry.js";
import { odraDictionaryItemKey, odraIndexBytes } from "./casper-rpc-read.js";

describe("casper-rpc-retry", () => {
  it("detects HTTP 429 errors", () => {
    expect(isRateLimitError(new Error("Code: 429, err: "))).toBe(true);
    expect(isRateLimitError(new Error("network down"))).toBe(false);
  });

  it("fast-fail does not retry on 429", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Code: 429"))
      .mockResolvedValue("ok");
    await expect(withRpcCall(fn, "fast-fail")).rejects.toThrow("429");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fast-fail retries once on non-429 errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue("ok");
    await expect(withRpcCall(fn, "fast-fail")).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("odra storage keys", () => {
  it("packs short module paths like Odra index_bytes", () => {
    expect(odraIndexBytes([1]).toString("hex")).toBe("00000001");
  });

  it("produces stable 64-char dictionary item keys", () => {
    const key = odraDictionaryItemKey([1], Buffer.from([0x00, 0x01]));
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]+$/);
  });
});
