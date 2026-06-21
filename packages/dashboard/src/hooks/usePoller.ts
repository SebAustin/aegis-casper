"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export type PollStatus = "idle" | "loading" | "success" | "error";

interface UsePollResult<T> {
  data: T | null;
  status: PollStatus;
  error: string | null;
  lastUpdatedMs: number | null;
  /** Milliseconds until next poll. */
  countdown: number;
  refetch: () => void;
}

export interface UsePollerOptions {
  /** Poll interval in ms (default 15_000). */
  intervalMs?: number;
  /** Skip a tick while a prior fetch is still in flight (default true). */
  skipOverlapping?: boolean;
}

const DEFAULT_INTERVAL_MS = 15_000;

/**
 * Polls `fetchFn` on an interval (FR-D-06).
 * Tolerates fetch errors — keeps last known data when a refresh fails.
 */
export function usePoller<T>(
  fetchFn: () => Promise<T>,
  options: UsePollerOptions = {}
): UsePollResult<T> {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const skipOverlapping = options.skipOverlapping ?? true;

  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<PollStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedMs, setLastUpdatedMs] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(intervalMs);

  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  const lastFetchRef = useRef<number>(0);
  const inFlightRef = useRef(false);
  const dataRef = useRef<T | null>(null);
  dataRef.current = data;

  const doFetch = useCallback(async () => {
    if (skipOverlapping && inFlightRef.current) return;

    inFlightRef.current = true;
    setStatus((prev) =>
      prev === "idle" && dataRef.current === null ? "loading" : prev
    );

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
      if (dataRef.current === null) {
        setStatus("error");
      } else {
        setStatus("success");
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [skipOverlapping]);

  // Initial fetch on mount.
  useEffect(() => {
    void doFetch();
  }, [doFetch]);

  // Polling interval.
  useEffect(() => {
    const id = setInterval(() => {
      if (skipOverlapping && inFlightRef.current) return;
      void doFetch();
    }, intervalMs);
    return () => clearInterval(id);
  }, [doFetch, intervalMs, skipOverlapping]);

  // Countdown tick (updates every second for the progress bar).
  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = Date.now() - (lastFetchRef.current || Date.now());
      const remaining = Math.max(0, intervalMs - elapsed);
      setCountdown(remaining);
    }, 1000);
    return () => clearInterval(id);
  }, [intervalMs]);

  return { data, status, error, lastUpdatedMs, countdown, refetch: doFetch };
}
