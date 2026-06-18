"use client";

import { useState } from "react";

type TriggerState = "idle" | "loading" | "success" | "error";

/**
 * DESIGN.md §6.9 — Trigger Agent Run control.
 * Outlined cyan, play icon. On 1024px: icon-only.
 */
export function TriggerAgentRunButton() {
  const [state, setState] = useState<TriggerState>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const handleTrigger = async () => {
    if (state === "loading") return;
    setState("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/trigger", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Trigger failed");
      }
      setState("success");
      setTimeout(() => setState("idle"), 2000);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Agent run failed to start. Check that the agent process is running.";
      setErrorMsg(msg);
      setState("error");
      setTimeout(() => setState("idle"), 3000);
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
      ? "Running…"
      : state === "success"
      ? "Done"
      : state === "error"
      ? "Failed"
      : "Trigger Agent Run";

  return (
    <button
      type="button"
      onClick={handleTrigger}
      disabled={state === "loading"}
      aria-label="Trigger immediate agent run"
      aria-busy={state === "loading" || undefined}
      title={state === "error" ? errorMsg : undefined}
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
        cursor: state === "loading" ? "not-allowed" : "pointer",
        opacity: state === "loading" ? 0.7 : 1,
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
      <span className="trigger-label">{label}</span>
    </button>
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
