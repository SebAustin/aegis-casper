import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import type { DecisionLogEntry } from "@aegis/shared";
import { parseDecisionLogLine, resolveRepoLogPath } from "@aegis/shared";

/**
 * GET /api/decisions
 *
 * Reads the last 20 entries from logs/decisions.jsonl (FR-D-03).
 * Legacy rows are coerced via normalizeDecisionLogEntry before display.
 */
export async function GET(): Promise<NextResponse> {
  const logsPath = resolveRepoLogPath("decisions.jsonl");

  if (!existsSync(logsPath)) {
    return NextResponse.json<DecisionLogEntry[]>([], {
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

    return NextResponse.json(entries, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
