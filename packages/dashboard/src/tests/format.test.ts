/**
 * Unit tests for dashboard format utilities.
 */
import { describe, it, expect } from "vitest";
import {
  formatCspr,
  formatCsprParts,
  formatShares,
  formatBps,
  formatApyBps,
  truncateHash,
  relativeTime,
  confidenceClass,
  getAssetLabel,
  formatSkipReason,
} from "../lib/format";

describe("formatCspr", () => {
  it("formats motes to CSPR string with 2 decimal places", () => {
    expect(formatCspr(BigInt("12450000000000"))).toBe("12,450.00 CSPR");
  });

  it("formats zero motes", () => {
    expect(formatCspr(BigInt(0))).toBe("0.00 CSPR");
  });

  it("formats fractional CSPR", () => {
    expect(formatCspr(BigInt("1500000000"))).toBe("1.50 CSPR");
  });
});

describe("formatCsprParts", () => {
  it("splits integer and fraction", () => {
    const { integer, fraction } = formatCsprParts(BigInt("12450000000000"));
    expect(integer).toBe("12,450");
    expect(fraction).toBe("00");
  });
});

describe("formatShares", () => {
  it("formats shares with 6 decimal places", () => {
    // 1 share = 1_000_000 micro-shares
    expect(formatShares(BigInt("12450000000"))).toBe("12,450.000000 AEGIS");
  });
});

describe("formatBps", () => {
  it("converts basis points to percentage", () => {
    expect(formatBps(4250)).toBe("42.5%");
    expect(formatBps(10000)).toBe("100.0%");
    expect(formatBps(0)).toBe("0.0%");
  });
});

describe("formatApyBps", () => {
  it("formats APY basis points correctly", () => {
    expect(formatApyBps(624)).toBe("6.24%");
    expect(formatApyBps(850)).toBe("8.50%");
  });
});

describe("truncateHash", () => {
  it("truncates a long hash to [6]…[4]", () => {
    const hash = "a7f3c1d4e9b28765432100fedcba987654321abc";
    expect(truncateHash(hash)).toBe("a7f3c1…1abc");
    // first 6 + … + last 4
    const result = truncateHash(hash);
    expect(result.startsWith("a7f3c1")).toBe(true);
    expect(result.endsWith("1abc")).toBe(true);
    expect(result).toContain("…");
  });

  it("returns short hashes unchanged", () => {
    expect(truncateHash("abc")).toBe("abc");
  });
});

describe("relativeTime", () => {
  it("returns 'Xs ago' for seconds", () => {
    const now = Date.now();
    expect(relativeTime(now - 30_000)).toBe("30s ago");
  });

  it("returns 'Xm Ys ago' for minutes", () => {
    const now = Date.now();
    expect(relativeTime(now - 272_000)).toMatch(/4m \d+s ago/);
  });

  it("returns ISO date for timestamps > 24h old", () => {
    const old = new Date("2026-06-17T00:00:00Z").getTime();
    expect(relativeTime(old)).toBe("2026-06-17");
  });

  it("returns 'just now' for future timestamps", () => {
    expect(relativeTime(Date.now() + 1000)).toBe("just now");
  });
});

describe("confidenceClass", () => {
  it("returns high for >= 80", () => {
    expect(confidenceClass(80)).toBe("high");
    expect(confidenceClass(100)).toBe("high");
  });

  it("returns mid for 60-79", () => {
    expect(confidenceClass(60)).toBe("mid");
    expect(confidenceClass(79)).toBe("mid");
  });

  it("returns low for < 60", () => {
    expect(confidenceClass(59)).toBe("low");
    expect(confidenceClass(0)).toBe("low");
  });
});

describe("getAssetLabel", () => {
  it("returns oracle name when provided", () => {
    expect(getAssetLabel(0, "T-Bill")).toBe("T-Bill");
  });

  it("returns default label when no oracle name", () => {
    expect(getAssetLabel(0)).toBe("T-Bill");
    expect(getAssetLabel(4)).toBe("Other");
  });
});

describe("formatSkipReason", () => {
  it("explains oracle_unavailable", () => {
    expect(formatSkipReason("oracle_unavailable")).toContain("pnpm oracle");
  });

  it("explains rpc_rate_limited", () => {
    expect(formatSkipReason("rpc_rate_limited")).toContain("CSPR.cloud");
  });

  it("explains iteration fetch failures", () => {
    expect(formatSkipReason("iteration_error: TypeError: fetch failed")).toContain(
      "Oracle"
    );
  });
});
