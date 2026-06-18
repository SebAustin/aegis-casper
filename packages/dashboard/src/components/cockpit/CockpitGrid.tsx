"use client";

import { usePoller } from "@/hooks/usePoller";
import type { VaultState, AgentReputation, DecisionLogEntry, RwaOracleData } from "@aegis/shared";
import { VaultOverviewPanel } from "./VaultOverviewPanel";
import { AllocationChartPanel } from "./AllocationChartPanel";
import { ReputationPanel } from "./ReputationPanel";
import { DecisionFeedPanel } from "./DecisionFeedPanel";
import { OraclePanel } from "./OraclePanel";

async function fetchVault(): Promise<VaultState> {
  const res = await fetch("/api/vault", { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  // bigint fields arrive as strings over JSON — coerce them back.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await res.json();
  return {
    ...raw,
    totalBalanceMotes: BigInt(raw.totalBalanceMotes ?? 0),
    totalShares: BigInt(raw.totalShares ?? 0),
  } as VaultState;
}

async function fetchReputation(): Promise<AgentReputation> {
  const res = await fetch("/api/reputation", { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await res.json();
  return {
    ...raw,
    score: BigInt(raw.score ?? 0),
    totalDecisions: BigInt(raw.totalDecisions ?? 0),
    correctPredictions: BigInt(raw.correctPredictions ?? 0),
  } as AgentReputation;
}

async function fetchDecisions(): Promise<DecisionLogEntry[]> {
  const res = await fetch("/api/decisions", { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as DecisionLogEntry[];
}

async function fetchOracle(): Promise<RwaOracleData> {
  const res = await fetch("/api/oracle", { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await res.json();
  return {
    ...raw,
    paymentReceipt: raw.paymentReceipt
      ? {
          ...raw.paymentReceipt,
          amountMotes: BigInt(raw.paymentReceipt.amountMotes ?? 0),
        }
      : undefined,
  } as RwaOracleData;
}

/**
 * CockpitGrid — 12-column bento layout (DESIGN.md §4).
 *
 * Top row: Vault (5 cols) | Allocation (4 cols) | Reputation (3 cols)
 * Bottom row: Decision Feed (7 cols) | Oracle (5 cols)
 */
export function CockpitGrid() {
  const vault = usePoller(fetchVault);
  const reputation = usePoller(fetchReputation);
  const decisions = usePoller(fetchDecisions);
  const oracle = usePoller(fetchOracle);

  // Share the countdown from vault poller for the global poll bar.
  const countdown = vault.countdown;

  return (
    <div className="cockpit-grid">
      {/* ── Row 1 ────────────────────────────────────────────────── */}
      <div
        style={{
          gridColumn: "span 5",
        }}
        className="cockpit-vault"
      >
        <VaultOverviewPanel
          data={vault.data}
          status={vault.status}
          error={vault.error}
          lastUpdatedMs={vault.lastUpdatedMs}
        />
      </div>

      <div style={{ gridColumn: "span 4" }} className="cockpit-alloc">
        <AllocationChartPanel
          allocation={vault.data?.allocation ?? null}
          oracleAssets={oracle.data?.assets ?? null}
          status={vault.status}
        />
      </div>

      <div style={{ gridColumn: "span 3" }} className="cockpit-rep">
        <ReputationPanel
          data={reputation.data}
          status={reputation.status}
          error={reputation.error}
        />
      </div>

      {/* ── Row 2 ────────────────────────────────────────────────── */}
      <div style={{ gridColumn: "span 7" }} className="cockpit-feed">
        <DecisionFeedPanel
          entries={decisions.data}
          status={decisions.status}
          error={decisions.error}
          countdown={countdown}
          refetch={decisions.refetch}
        />
      </div>

      <div style={{ gridColumn: "span 5" }} className="cockpit-oracle">
        <OraclePanel
          data={oracle.data}
          status={oracle.status}
          error={oracle.error}
        />
      </div>
    </div>
  );
}
