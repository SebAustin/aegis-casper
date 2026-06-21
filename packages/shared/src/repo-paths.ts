/**
 * Resolve monorepo-root paths regardless of process.cwd() (Next.js vs agent).
 */

import { existsSync } from "node:fs";
import path from "node:path";

/** Walk up from cwd to find a directory containing `logs/` or `.env`. */
export function findMonorepoRoot(startDir: string = process.cwd()): string {
  let dir = startDir;
  for (let depth = 0; depth < 12; depth++) {
    if (
      existsSync(path.join(dir, "logs")) ||
      existsSync(path.join(dir, ".env")) ||
      existsSync(path.join(dir, "pnpm-workspace.yaml"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

export function resolveRepoLogPath(filename: string): string {
  return path.join(findMonorepoRoot(), "logs", filename);
}
