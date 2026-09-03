/**
 * Walk up the directory tree from a start directory looking for a file.
 * Used to locate package-root files (prices.json, package.json) from both
 * src/ (tsx/vitest) and dist/ (built) module locations.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function findFileUpward(startDir: string, fileName: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, fileName);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
