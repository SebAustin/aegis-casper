/** Fired when the user successfully triggers a manual agent iteration. */
export const AEGIS_AGENT_TRIGGER_EVENT = "aegis-agent-trigger";

export function dispatchAgentTrigger(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AEGIS_AGENT_TRIGGER_EVENT));
}
