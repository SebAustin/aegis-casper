import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { DecisionLogEntry } from "@aegis/shared";
import { decisionLogEntrySchema } from "@aegis/shared";

/**
 * GET /api/decisions
 *
 * Reads the last 20 entries from logs/decisions.jsonl (FR-D-03).
 * The file is written by the agent package — this route provides a
 * server-side read so no filesystem path is exposed to the client bundle.
 */
export async function GET(): Promise<NextResponse> {
  // Resolve relative to the monorepo root (two levels up from packages/dashboard).
  const logsPath = resolve(process.cwd(), "../../logs/decisions.jsonl");

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
    for (const line of lines.slice(-20)) {
      const parsed: unknown = JSON.parse(line);
      const result = decisionLogEntrySchema.safeParse(parsed);
      if (result.success) {
        entries.push(result.data as unknown as DecisionLogEntry);
      }
    }

    // Most recent first.
    entries.reverse();

    return NextResponse.json(entries, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
