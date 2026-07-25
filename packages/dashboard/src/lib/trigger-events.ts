import type { DecisionLogEntry } from "@aegis/shared";

/** Fired when the user successfully triggers a manual agent iteration. */
export const AEGIS_AGENT_TRIGGER_EVENT = "aegis-agent-trigger";

/** Optional payload carried by the trigger event (demo-mode decisions only). */
export interface AgentTriggerEventDetail {
  /** The freshly generated demo decision, when the trigger ran in demo mode. */
  decision?: DecisionLogEntry;
  demo?: boolean;
}

/**
 * Notify listeners (e.g. `CockpitGrid`) that the agent was triggered.
 *
 * When the trigger ran in demo mode, `detail.decision` carries the fresh
 * simulated `DecisionLogEntry` so it can be prepended to the visible Decision
 * Feed immediately, without waiting on a poll.
 */
export function dispatchAgentTrigger(detail?: AgentTriggerEventDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AgentTriggerEventDetail>(AEGIS_AGENT_TRIGGER_EVENT, {
      detail: detail ?? {},
    })
  );
}
