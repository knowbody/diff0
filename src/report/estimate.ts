import type { Estimate } from "../harness/estimate.js";
import { formatDuration, formatUsd, shortSha } from "./format.js";

/** Human-scale duration for projections: "42.0s", "4m 12s", "1h 05m". */
function formatLongDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return formatDuration(ms);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function renderEstimate(estimate: Estimate): string {
  const lines: string[] = [];
  lines.push(
    `diff0 estimate: ${estimate.baseRef}...${estimate.headRef} ` +
      `(${estimate.runsPerRef} runs per ref planned)`,
  );
  lines.push("");
  if (estimate.sampleSource === "base-cache") {
    lines.push(
      `  sample:          ${estimate.sampleRuns} cached base runs ` +
        `(${estimate.baseRef} @ ${shortSha(estimate.baseSha)}) — no eval run spent`,
    );
  } else {
    lines.push(
      `  sample:          1 fresh suite run on head ` +
        `(${estimate.headRef} @ ${shortSha(estimate.headSha)})`,
    );
  }
  lines.push(`  evals per run:   ${estimate.evalsPerRun}`);
  if (estimate.perRunCostUsd !== null) {
    lines.push(`  cost per run:    ${formatUsd(estimate.perRunCostUsd)} (${estimate.costSource})`);
  } else {
    lines.push(
      `  cost per run:    unavailable — model ${estimate.model} is not in prices.json ` +
        "and eve reported no gateway cost;",
    );
    lines.push("                   the comparison will run but report cost as unavailable");
  }
  lines.push(`  time per run:    ${formatDuration(estimate.perRunDurationMs)}`);
  const runsBreakdown =
    estimate.cachedBaseRuns > 0
      ? `${estimate.chargeableRuns} (head only — ${estimate.cachedBaseRuns} base runs already cached)`
      : `${estimate.chargeableRuns} (${estimate.runsPerRef} per ref x 2 refs)`;
  lines.push(
    `  planned cache:   ${estimate.plannedCacheReuse ? "reuse enabled" : "disabled (default run policy)"}`,
  );
  lines.push(`  projected runs:  ${runsBreakdown}`);
  lines.push(
    `  projected cost:  ${
      estimate.projectedCostUsd !== null ? formatUsd(estimate.projectedCostUsd) : "unavailable"
    }`,
  );
  lines.push(`  projected time:  ~${formatLongDuration(estimate.projectedDurationMs)}`);
  lines.push("");
  const sampledOn = estimate.sampleSource === "base-cache" ? "base" : "head";
  lines.push(
    `Measured on ${sampledOn} only — base and head may genuinely differ in cost and duration.`,
  );
  return `${lines.join("\n")}\n`;
}
