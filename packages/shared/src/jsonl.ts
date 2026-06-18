/**
 * JSONL (newline-delimited JSON) append/read helpers.
 *
 * Used by the agent and oracle to write to logs/decisions.jsonl and
 * logs/payments.jsonl respectively (FR-A-03, FR-O-05, SC-04).
 *
 * Design:
 * - appendJsonl: O(1) append via a single `fs.appendFile` call.
 * - readJsonl: reads the whole file and parses each non-empty line.
 *   Malformed lines are skipped with a warning, never thrown.
 * - Single writer per file assumed (NFR-O-02 ordering guarantee).
 */

import { appendFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Append a single JSON record as a JSONL line.
 *
 * BigInt values are serialised as strings (JSON does not support BigInt natively).
 * Creates the parent directory if it does not exist.
 */
export async function appendJsonl<T>(filePath: string, record: T): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const line = JSON.stringify(record, bigIntReplacer) + "\n";
  await appendFile(filePath, line, "utf8");
}

/**
 * Read all records from a JSONL file.
 *
 * @param filePath  Path to the .jsonl file.
 * @param limit     Optional: return only the last N records.
 * @returns Array of parsed records. Never throws — returns [] on missing file.
 */
export async function readJsonl<T>(
  filePath: string,
  limit?: number
): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    // File doesn't exist yet — that's fine
    return [];
  }

  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const selected = limit !== undefined ? lines.slice(-limit) : lines;

  const results: T[] = [];

  for (const line of selected) {
    try {
      results.push(JSON.parse(line, bigIntReviver) as T);
    } catch (err) {
      // Log a warning but keep processing the rest of the file
      process.stderr.write(
        `[aegis/jsonl] Skipping malformed line in ${filePath}: ${String(err)}\n`
      );
    }
  }

  return results;
}

// ── BigInt serialisation ─────────────────────────────────────────────────────

function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

function bigIntReviver(_key: string, value: unknown): unknown {
  // Strings that look like large integers (e.g. from Motes) are not auto-revived
  // to avoid accidental type confusion. Callers cast explicitly where needed.
  return value;
}
