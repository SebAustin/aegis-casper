"use client";

import { useState, useEffect } from "react";
import { usePoller } from "@/hooks/usePoller";
import type { VaultState, AgentReputation, DecisionLogEntry, RwaOracleData } from "@aegis/shared";
import {
  getMockVaultOverlay,
  isMockWalletMode,
  MOCK_VAULT_OVERLAY_EVENT,
} from "@/lib/mock-vault-overlay";
import { AEGIS_AGENT_TRIGGER_EVENT } from "@/lib/trigger-events";
import { VaultOverviewPanel } from "./VaultOverviewPanel";
import { AllocationChartPanel } from "./AllocationChartPanel";
import { ReputationPanel } from "./ReputationPanel";
import { DecisionFeedPanel } from "./DecisionFeedPanel";
import { OraclePanel } from "./OraclePanel";

const FETCH_TIMEOUT_MS = 8_000;
const SLOW_POLL_MS = 60_000;

interface VaultPollData {
  state: VaultState;
  dataWarning?: string;
}

interface ReputationPollData {
  reputation: AgentReputation;
  dataWarning?: string;
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  return fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function fetchVault(): Promise<VaultPollData> {
  const res = await fetchJsonWithTimeout("/api/vault");
  if (!res.ok) throw new Error(await res.text());
  const dataWarning = res.headers.get("X-Data-Warning") ?? undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await res.json();
  return {
    dataWarning,
    state: {
      ...raw,
      totalBalanceMotes: BigInt(raw.totalBalanceMotes ?? 0),
      totalShares: BigInt(raw.totalShares ?? 0),
    } as VaultState,
  };
}

async function fetchReputation(): Promise<ReputationPollData> {
  const res = await fetchJsonWithTimeout("/api/reputation");
  if (!res.ok) throw new Error(await res.text());
  const dataWarning = res.headers.get("X-Data-Warning") ?? undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await res.json();
  return {
    dataWarning,
    reputation: {
      ...raw,
      score: BigInt(raw.score ?? 50),
      totalDecisions: BigInt(raw.totalDecisions ?? 0),
      correctPredictions: BigInt(raw.correctPredictions ?? 0),
    } as AgentReputation,
  };
}

async function fetchDecisions(): Promise<DecisionLogEntry[]> {
  const res = await fetchJsonWithTimeout("/api/decisions");
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as DecisionLogEntry[];
}

interface OraclePollData {
  data: RwaOracleData;
  dataSource?: string;
}

async function fetchOracle(): Promise<OraclePollData> {
  const res = await fetchJsonWithTimeout("/api/oracle");
  if (!res.ok) throw new Error(await res.text());
  const dataSource = res.headers.get("X-Data-Source") ?? "live";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await res.json();
  return {
    dataSource,
    data: {
      ...raw,
      paymentReceipt: raw.paymentReceipt
        ? {
            ...raw.paymentReceipt,
            amountMotes: BigInt(raw.paymentReceipt.amountMotes ?? 0),
          }
        : undefined,
    } as RwaOracleData,
  };
}

const slowPollOptions = { intervalMs: SLOW_POLL_MS, skipOverlapping: true };

/**
 * CockpitGrid — 12-column bento layout (DESIGN.md §4).
 */
export function CockpitGrid() {
  const vault = usePoller(fetchVault, slowPollOptions);
  const [overlayTick, setOverlayTick] = useState(0);

  useEffect(() => {
    if (!isMockWalletMode()) return;
    const bump = () => setOverlayTick((n) => n + 1);
    window.addEventListener(MOCK_VAULT_OVERLAY_EVENT, bump);
    return () => window.removeEventListener(MOCK_VAULT_OVERLAY_EVENT, bump);
  }, []);

  const vaultData = (() => {
    void overlayTick;
    const base = vault.data?.state;
    if (!base || !isMockWalletMode()) return base ?? null;
    const overlay = getMockVaultOverlay();
    return {
      ...base,
      totalBalanceMotes: base.totalBalanceMotes + overlay.addedBalanceMotes,
      totalShares: base.totalShares + overlay.addedShares,
    } satisfies VaultState;
  })();

  const reputation = usePoller(fetchReputation, slowPollOptions);
  const decisions = usePoller(fetchDecisions);
  const oracle = usePoller(fetchOracle);

  useEffect(() => {
    const refresh = () => {
      void decisions.refetch();
      void vault.refetch();
      void reputation.refetch();
      void oracle.refetch();
      window.setTimeout(() => {
        void decisions.refetch();
        void reputation.refetch();
      }, 3500);
    };
    window.addEventListener(AEGIS_AGENT_TRIGGER_EVENT, refresh);
    return () => window.removeEventListener(AEGIS_AGENT_TRIGGER_EVENT, refresh);
  }, [decisions.refetch, vault.refetch, reputation.refetch, oracle.refetch]);

  const countdown = vault.countdown;

  return (
    <div className="cockpit-grid">
      <div style={{ gridColumn: "span 5" }} className="cockpit-vault">
        <VaultOverviewPanel
          data={vaultData}
          status={vault.status}
          error={vault.error}
          lastUpdatedMs={vault.lastUpdatedMs}
          dataWarning={vault.data?.dataWarning}
        />
      </div>

      <div style={{ gridColumn: "span 4" }} className="cockpit-alloc">
        <AllocationChartPanel
          allocation={vaultData?.allocation ?? null}
          oracleAssets={oracle.data?.data?.assets ?? null}
          status={vault.status}
        />
      </div>

      <div style={{ gridColumn: "span 3" }} className="cockpit-rep">
        <ReputationPanel
          data={reputation.data?.reputation ?? null}
          status={reputation.status}
          error={reputation.error}
          dataWarning={reputation.data?.dataWarning}
        />
      </div>

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
          data={oracle.data?.data ?? null}
          dataSource={oracle.data?.dataSource}
          status={oracle.status}
          error={oracle.error}
        />
      </div>
    </div>
  );
}
