import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(join(root, ".eve"), { recursive: true });
const fixture = mkdtempSync(join(root, ".eve/station-retry-proof-"));
try {
  cpSync(join(root, "test/fixtures/station-retries"), fixture, { recursive: true });
  for (const file of ["hooks/station-retries.ts", "lib/station-retries.ts"]) {
    const destination = join(fixture, "agent", file);
    mkdirSync(join(destination, ".."), { recursive: true });
    cpSync(join(root, "agent", file), destination);
  }
  symlinkSync(join(root, "node_modules"), join(fixture, "node_modules"), "dir");
  const result = spawnSync(
    process.execPath,
    [join(root, "node_modules/eve/bin/eve.js"), "eval", "retries", "--json", "--skip-report"],
    {
      cwd: fixture,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  writeFileSync(join(root, ".eve/station-retry-proof.json"), result.stdout ?? "");
  writeFileSync(join(root, ".eve/station-retry-proof.stderr"), result.stderr ?? "");
  if (result.status !== 0)
    throw new Error(
      "Station retry runtime proof failed; inspect .eve/station-retry-proof.json and .stderr.",
    );
  console.log(
    "Mock runtime proof passed: exactly two failed station calls, then termination. No model charges.",
  );
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
