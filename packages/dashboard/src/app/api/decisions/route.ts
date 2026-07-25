import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import type { DecisionLogEntry } from "@aegis/shared";
import {
  buildDemoDecisionFeed,
  parseDecisionLogLine,
  resolveRepoLogPath,
} from "@aegis/shared";
import { isDemoMode } from "@/lib/demo-mode";

/**
 * GET /api/decisions
 *
 * Reads the last 20 entries from logs/decisions.jsonl (FR-D-03).
 * Legacy rows are coerced via normalizeDecisionLogEntry before display.
 *
 * On a hosted (serverless) deploy there is no running agent and no log
 * file — when `NEXT_PUBLIC_DEMO_MODE=true` and the log is missing/empty, a
 * seeded demo feed is returned instead so the dashboard is never blank.
 */
export async function GET(): Promise<NextResponse> {
  const logsPath = resolveRepoLogPath("decisions.jsonl");
  const demoMode = isDemoMode();

  if (!existsSync(logsPath)) {
    const entries = demoMode ? buildDemoDecisionFeed() : [];
    return NextResponse.json<DecisionLogEntry[]>(entries, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const text = readFileSync(logsPath, "utf8");
    const lines = text
      .split("\n")
      .filter((l) => l.trim().length > 0);

    const entries: DecisionLogEntry[] = [];
    let skipped = 0;

    for (const line of lines.slice(-20)) {
      const parsed: unknown = JSON.parse(line);
      const entry = parseDecisionLogLine(parsed);
      if (entry) {
        entries.push(entry);
      } else {
        skipped++;
      }
    }

    if (skipped > 0) {
      process.stderr.write(
        `[dashboard/api/decisions] skipped ${skipped} unparseable line(s)\n`
      );
    }

    entries.reverse();

    if (entries.length === 0 && demoMode) {
      return NextResponse.json(buildDemoDecisionFeed(), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    return NextResponse.json(entries, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
