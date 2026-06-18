"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export type PollStatus = "idle" | "loading" | "success" | "error";

interface UsePollResult<T> {
  data: T | null;
  status: PollStatus;
  error: string | null;
  lastUpdatedMs: number | null;
  /** Milliseconds until next poll (0–15000). */
  countdown: number;
  refetch: () => void;
}

const POLL_INTERVAL_MS = 15_000;

/**
 * Polls `fetchFn` every 15 seconds (FR-D-06).
 * Tolerates fetch errors — returns last known data with error message.
 */
export function usePoller<T>(fetchFn: () => Promise<T>): UsePollResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<PollStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedMs, setLastUpdatedMs] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(POLL_INTERVAL_MS);

  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  const lastFetchRef = useRef<number>(0);

  const doFetch = useCallback(async () => {
    setStatus((prev) => (prev === "idle" ? "loading" : prev));
    try {
      const result = await fetchFnRef.current();
      setData(result);
      setStatus("success");
      setError(null);
      const now = Date.now();
      setLastUpdatedMs(now);
      lastFetchRef.current = now;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setStatus("error");
    }
  }, []);

  // Initial fetch on mount.
  useEffect(() => {
    void doFetch();
  }, [doFetch]);

  // Polling interval.
  useEffect(() => {
    const id = setInterval(() => {
      void doFetch();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [doFetch]);

  // Countdown tick (updates every second for the progress bar).
  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = Date.now() - (lastFetchRef.current || Date.now());
      const remaining = Math.max(0, POLL_INTERVAL_MS - elapsed);
      setCountdown(remaining);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return { data, status, error, lastUpdatedMs, countdown, refetch: doFetch };
}
