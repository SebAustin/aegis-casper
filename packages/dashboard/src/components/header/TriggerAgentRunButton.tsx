"use client";

import { useState, useEffect } from "react";
import { dispatchAgentTrigger } from "@/lib/trigger-events";
import { formatCountdown } from "@/lib/format";

type TriggerState = "idle" | "loading" | "success" | "error";

interface AgentStatus {
  reachable: boolean;
  iterationRunning: boolean;
  inRpcCooldown: boolean;
  rpcCooldownRemainingMs: number;
}

/**
 * DESIGN.md §6.9 — Trigger Agent Run control.
 * Outlined cyan, play icon. Shows a fixed toast so feedback is obvious.
 */
export function TriggerAgentRunButton() {
  const [state, setState] = useState<TriggerState>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [cooldownTick, setCooldownTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const pollStatus = async () => {
      try {
        const res = await fetch("/api/agent-status", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as AgentStatus;
        if (!cancelled) setAgentStatus(body);
      } catch {
        if (!cancelled) {
          setAgentStatus({
            reachable: false,
            iterationRunning: false,
            inRpcCooldown: false,
            rpcCooldownRemainingMs: 0,
          });
        }
      }
    };

    void pollStatus();
    const id = window.setInterval(() => void pollStatus(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!agentStatus?.inRpcCooldown || agentStatus.rpcCooldownRemainingMs <= 0) {
      return;
    }
    const id = window.setInterval(() => setCooldownTick((n) => n + 1), 1_000);
    return () => window.clearInterval(id);
  }, [agentStatus?.inRpcCooldown, agentStatus?.rpcCooldownRemainingMs]);

  void cooldownTick;

  const cooldownMs = agentStatus?.rpcCooldownRemainingMs ?? 0;
  const inCooldown = agentStatus?.inRpcCooldown === true && cooldownMs > 0;
  const agentUnreachable = agentStatus?.reachable === false;
  const agentBusy = agentStatus?.iterationRunning === true;

  const showToast = (message: string, ms = 5000) => {
    setToast(message);
    window.setTimeout(() => setToast(null), ms);
  };

  const handleTrigger = async () => {
    if (state === "loading" || inCooldown || agentBusy) return;
    setState("loading");
    setErrorMsg("");
    showToast("Starting agent run…", 8000);

    try {
      const res = await fetch("/api/trigger", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        cooldownRemainingMs?: number;
      };

      if (res.status === 503) {
        const msg =
          body.error ??
          "Agent is in RPC cooldown — wait before triggering again.";
        setErrorMsg(msg);
        setState("error");
        showToast(msg, 8000);
        if (typeof body.cooldownRemainingMs === "number") {
          setAgentStatus((prev) =>
            prev
              ? { ...prev, inRpcCooldown: true, rpcCooldownRemainingMs: body.cooldownRemainingMs! }
              : {
                  reachable: true,
                  iterationRunning: false,
                  inRpcCooldown: true,
                  rpcCooldownRemainingMs: body.cooldownRemainingMs!,
                }
          );
        }
        window.setTimeout(() => setState("idle"), 4000);
        return;
      }

      if (!res.ok) {
        throw new Error(body.error ?? `Trigger failed (${res.status})`);
      }

      setState("success");
      dispatchAgentTrigger();
      showToast(
        "Agent run started — check Decision Feed for the new entry.",
        6000
      );

      const feed = document.getElementById("feed-heading");
      feed?.scrollIntoView({ behavior: "smooth", block: "nearest" });

      window.setTimeout(() => setState("idle"), 3000);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Agent run failed. Is `pnpm agent` running?";
      setErrorMsg(msg);
      setState("error");
      showToast(msg, 8000);
      window.setTimeout(() => setState("idle"), 4000);
    }
  };

  const borderColor =
    state === "error"
      ? "var(--color-danger)"
      : state === "success"
      ? "var(--color-positive)"
      : "var(--color-accent-cyan)";

  const textColor =
    state === "error"
      ? "var(--color-danger)"
      : state === "success"
      ? "var(--color-positive)"
      : "var(--color-accent-cyan)";

  const label =
    state === "loading"
      ? "Trigger sent…"
      : state === "success"
      ? "Done"
      : state === "error"
      ? "Failed"
      : inCooldown
      ? `Cooldown ${formatCountdown(cooldownMs)}`
      : agentBusy
      ? "Agent busy…"
      : agentUnreachable
      ? "Agent offline"
      : "Trigger Agent Run";

  const triggerDisabled =
    state === "loading" || inCooldown || agentBusy || agentUnreachable;

  const helperTitle = inCooldown
    ? `RPC cooldown — on-chain reads were rate-limited. Retry in ${formatCountdown(cooldownMs)}.`
    : agentUnreachable
    ? "Start the agent with `pnpm agent` (after `pnpm oracle`)."
    : agentBusy
    ? "Waiting for the current iteration to finish."
    : state === "error"
    ? errorMsg
    : undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => void handleTrigger()}
        disabled={triggerDisabled}
        aria-label={
          state === "error" && errorMsg
            ? `Trigger failed: ${errorMsg}`
            : helperTitle ?? "Trigger immediate agent run"
        }
        aria-busy={state === "loading" || agentBusy || undefined}
        title={helperTitle}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-2)",
          height: "36px",
          padding: "0 var(--space-3)",
          border: `1px solid ${borderColor}`,
          borderRadius: "var(--radius-md)",
          background: "var(--color-accent-cyan-10)",
          color: textColor,
          fontFamily: "var(--font-body)",
          fontSize: "var(--text-sm)",
          fontWeight: "var(--weight-medium)",
          cursor: triggerDisabled ? "not-allowed" : "pointer",
          opacity: triggerDisabled ? 0.7 : 1,
          transition: "box-shadow var(--duration-fast), opacity var(--duration-fast)",
          minHeight: "44px",
        }}
      >
        {state === "loading" ? (
          <SpinnerIcon color={textColor} />
        ) : state === "success" ? (
          <CheckIcon />
        ) : state === "error" ? (
          <XIcon />
        ) : (
          <PlayIcon />
        )}
        <span className="trigger-label trigger-label--long">{label}</span>
        <span className="trigger-label trigger-label--short">
          {state === "loading"
            ? "…"
            : state === "success"
            ? "✓"
            : state === "error"
            ? "!"
            : "Run"}
        </span>
      </button>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: "var(--space-6)",
            right: "var(--space-6)",
            zIndex: 500,
            maxWidth: "min(360px, calc(100vw - 2 * var(--space-6)))",
            padding: "var(--space-3) var(--space-4)",
            borderRadius: "var(--radius-md)",
            border: `1px solid ${
              state === "error"
                ? "var(--color-danger)"
                : "var(--color-accent-cyan)"
            }`,
            background: "var(--color-bg-overlay)",
            color: "var(--color-text-primary)",
            fontSize: "var(--text-sm)",
            boxShadow: "var(--shadow-lg)",
            lineHeight: 1.4,
          }}
        >
          {toast}
        </div>
      )}
    </>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M3 2.5l7 3.5-7 3.5V2.5z" />
    </svg>
  );
}

function SpinnerIcon({ color }: { color: string }) {
  return (
    <svg className="spinner" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" stroke={color} strokeWidth="1.5" strokeDasharray="20" strokeDashoffset="8" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 6.5l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
