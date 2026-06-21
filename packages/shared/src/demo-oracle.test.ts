import { describe, it, expect } from "vitest";
import { buildDemoOracleSnapshot } from "./demo-oracle.js";
import { rwaOracleDataSchema } from "./schemas.js";

describe("buildDemoOracleSnapshot", () => {
  it("returns a schema-valid payload with 5 assets", () => {
    const snapshot = buildDemoOracleSnapshot("account-hash-test");
    const result = rwaOracleDataSchema.safeParse(snapshot);
    expect(result.success).toBe(true);
    expect(snapshot.assets).toHaveLength(5);
    expect(snapshot.paymentReceipt.payerAccountHash).toBe("account-hash-test");
    expect(snapshot.oracleVersion).toBe("demo-fallback");
  });
});
