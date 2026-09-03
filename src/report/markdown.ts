/**
 * Markdown renderer for PR comments. Every
 * verdict, status, and caveat is precomputed in the DeltaReport; this file
 * only formats. Honest framing shows up as "X of N runs" everywhere.
 */
import type {
  DeltaReport,
  EvalDelta,
  EvalStatus,
  MetricDelta,
  RunSummary,
} from "../analyze/types.js";
import {
  formatDuration,
  formatInt,
  formatSignedPct,
  formatUsd,
  medianWithRange,
  passCell,
  runsPhrase,
  shortSha,
} from "./format.js";

/** Upsert anchor for the GitHub Action's comment update. */
export const REPORT_MARKER = "<!-- diff0-report -->";

function safeText(value: string): string {
  const withoutAnsi = value.replace(
    new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g"),
    "",
  );
  return [...withoutAnsi]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || (code >= 127 && code <= 159)
        ? `\\x${code.toString(16).padStart(2, "0")}`
        : character;
    })
    .join("")
    .replace(/@/g, "&#64;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/`/g, "&#96;")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function inlineCode(value: string): string {
  return `\`${safeText(value)}\``;
}

const VERDICT_EMOJI: Record<DeltaReport["verdict"], string> = {
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
};

const STATUS_TEXT: Record<EvalStatus, string> = {
  pass: "✅ pass",
  regressed: "🔴 **REGRESSED**",
  improved: "🟢 improved",
  fail: "❌ failing (both refs)",
  "flaky-base": "🟠 flaky (base)",
  "flaky-head": "🟠 flaky (head)",
  "flaky-both": "🟠 flaky (base + head)",
  "inconclusive-regression": "🟡 lower pass rate (inconclusive)",
  "inconclusive-improvement": "🟡 higher pass rate (inconclusive)",
  "partial-base": "🟡 incomplete coverage (base)",
  "partial-head": "🟡 incomplete coverage (head)",
  "partial-both": "🟡 incomplete coverage (base + head)",
  "missing-base": "➕ added",
  "missing-head": "➖ removed",
};

export function renderMarkdown(report: DeltaReport): string {
  const lines: string[] = [];
  const { meta } = report;
  const phrase = runsPhrase(meta);

  // 1. Title + verdict
  lines.push(REPORT_MARKER);
  lines.push(
    `## diff0: ${safeText(meta.base.ref)}...${safeText(meta.head.ref)} ${VERDICT_EMOJI[report.verdict]}`,
  );
  lines.push("");
  lines.push(`**${safeText(report.verdictSummary)}.**`);
  lines.push("");

  // 2. Comparison validity line (+ warnings)
  lines.push(validityLine(report));
  lines.push("");
  if (meta.mismatches.length > 0) {
    lines.push("> **⚠️ Comparison validity warnings**");
    for (const mismatch of meta.mismatches) {
      lines.push(`> - ${safeText(mismatch)}`);
    }
    lines.push("");
  }

  // 3. Evals table
  lines.push("### Evals");
  lines.push("");
  lines.push("| Eval | Base | Head | Status |");
  lines.push("| :-- | :--: | :--: | :-- |");
  for (const e of report.evals) {
    lines.push(
      `| ${inlineCode(e.name)} | ${passCell(e.basePassed, e.baseTotal)} | ` +
        `${passCell(e.headPassed, e.headTotal)} | ${statusCell(e)} |`,
    );
  }
  lines.push("");

  // 4. Behavioral drift
  lines.push("### Behavioral drift");
  lines.push("");
  if (!report.drift.hasDrift && !report.drift.hasInconclusive) {
    lines.push(`No behavioral drift detected across ${phrase}.`);
    lines.push("");
  } else {
    renderDrift(report, lines);
  }

  // 5. Cost & performance
  lines.push("### Cost & performance");
  lines.push("");
  lines.push("| Metric | Base (median) | Head (median) | Δ |");
  lines.push("| :-- | --: | --: | :-- |");
  lines.push(metricRow("Cost / session", report.costPerf.costUsd, formatUsd, "no cost data"));
  lines.push(metricRow("Tokens in", report.costPerf.tokensIn, formatInt, "no token data"));
  lines.push(metricRow("Tokens out", report.costPerf.tokensOut, formatInt, "no token data"));
  lines.push(
    metricRow("Cache-read tokens", report.costPerf.cacheReadTokens, formatInt, "no token data"),
  );
  lines.push(
    metricRow("Cache-write tokens", report.costPerf.cacheWriteTokens, formatInt, "no token data"),
  );
  lines.push(metricRow("Duration", report.costPerf.durationMs, formatDuration, "no timing data"));
  lines.push("");

  // 6. Changed files
  if (meta.gitDiffStat !== null) {
    lines.push("### Changed files");
    lines.push("");
    for (const file of meta.gitDiffStat.files) {
      lines.push(`- ${inlineCode(file.path)} (+${file.insertions} −${file.deletions})`);
    }
    lines.push("");
    lines.push(
      `_${safeText(meta.gitDiffStat.summary)}. File attribution is correlational, not causal._`,
    );
    lines.push("");
  }

  // 7. Per-run raw summaries
  lines.push("<details>");
  lines.push("<summary>Per-run raw summaries</summary>");
  lines.push("");
  renderRunTable(lines, "base", meta.base.ref, meta.base.commitSha, report.runSummaries.base);
  renderRunTable(lines, "head", meta.head.ref, meta.head.commitSha, report.runSummaries.head);
  lines.push("</details>");
  lines.push("");

  // Caveats + footer
  for (const caveat of report.caveats) {
    lines.push(`> ⚠️ ${safeText(caveat)}`);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push(
    `_Statistical comparison across ${phrase} — LLM runs are nondeterministic; ` +
      "treat proportions, not absolutes._",
  );

  return `${lines.join("\n")}\n`;
}

function validityLine(report: DeltaReport): string {
  const { meta } = report;
  const parts: string[] = [];
  parts.push(
    meta.base.eveVersion === meta.head.eveVersion
      ? `eve ${safeText(meta.base.eveVersion)}`
      : `eve base ${safeText(meta.base.eveVersion)} / head ${safeText(meta.head.eveVersion)}`,
  );
  parts.push(
    meta.base.model === meta.head.model
      ? `model ${inlineCode(meta.base.model)}`
      : `model base ${inlineCode(meta.base.model)} / head ${inlineCode(meta.head.model)}`,
  );
  parts.push(runsPhrase(meta));
  const inferredBase = meta.base.sandboxInferred ? " (inferred)" : "";
  parts.push(
    meta.base.sandboxBackend === meta.head.sandboxBackend
      ? `sandbox ${safeText(String(meta.base.sandboxBackend))}${inferredBase}`
      : `sandbox base ${safeText(String(meta.base.sandboxBackend))} / head ${safeText(String(meta.head.sandboxBackend))}${inferredBase}`,
  );
  parts.push(
    meta.totalComparisonCostUsd !== null
      ? `comparison cost ${formatUsd(meta.totalComparisonCostUsd)} (${meta.costSource})`
      : "comparison cost unavailable",
  );
  return parts.join(" · ");
}

function statusCell(e: EvalDelta): string {
  let cell = STATUS_TEXT[e.status];
  if (e.softScores) {
    const sign = e.softScores.delta >= 0 ? "+" : "";
    cell += ` · score ${e.softScores.baseMedian} → ${e.softScores.headMedian} (${sign}${e.softScores.delta})`;
    if (e.softScores.classification === "material-regression") {
      cell += ` · **material score regression** (threshold -${e.softScores.materialThreshold})`;
    }
  }
  if (e.status === "partial-base" || e.status === "partial-head" || e.status === "partial-both") {
    const coverage: string[] = [];
    if (e.baseTotal < e.baseExpectedRuns) {
      coverage.push(`base ${e.baseTotal}/${e.baseExpectedRuns} runs`);
    }
    if (e.headTotal < e.headExpectedRuns) {
      coverage.push(`head ${e.headTotal}/${e.headExpectedRuns} runs`);
    }
    cell += ` · coverage ${coverage.join(", ")}`;
  }
  if (e.twoProportionHint) {
    cell += ` · _hint: ${e.twoProportionHint.note}_`;
  }
  if (e.statisticalEvidence.pValue !== null) {
    cell +=
      ` · Fisher raw p=${formatPValue(e.statisticalEvidence.pValue)}` +
      ` · Holm p=${formatPValue(e.statisticalEvidence.adjustedPValue as number)}`;
  }
  return cell;
}

function formatPValue(value: number): string {
  return value < 0.0001 ? "<0.0001" : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function renderDrift(report: DeltaReport, lines: string[]): void {
  const { skills, toolSequences, subagents, toolInputs, finalOutputs } = report.drift;

  if (skills.length > 0) {
    lines.push("**Skills**");
    lines.push("");
    for (const s of skills) {
      const scope = s.evalName ? ` in eval ${inlineCode(s.evalName)}` : " (unattributed)";
      lines.push(
        `- ${inlineCode(s.name)}${scope}: loaded in ${s.baseLoadedRuns} of ${s.baseTotalRuns} base runs → ` +
          `${s.headLoadedRuns} of ${s.headTotalRuns} head runs — **${s.confidence}** ` +
          `(Fisher raw p=${formatPValue(s.pValue)}, Holm p=${formatPValue(s.adjustedPValue)})`,
      );
    }
    lines.push("");
  }

  if (toolSequences.length > 0) {
    lines.push("**Tool sequences**");
    lines.push("");
    for (const sequence of toolSequences) {
      const scope = sequence.evalName
        ? `eval ${inlineCode(sequence.evalName)}`
        : "unattributed calls";
      if (sequence.divergenceNote !== null) {
        lines.push(
          `- ${scope}, base most common (in ${sequence.baseMostCommonRuns} of ${sequence.baseTotalRuns} runs): ` +
            `${sequenceText(sequence.baseMostCommon)}`,
        );
        lines.push(
          `- ${scope}, head most common (in ${sequence.headMostCommonRuns} of ${sequence.headTotalRuns} runs): ` +
            `${sequenceText(sequence.headMostCommon)}`,
        );
        lines.push(`- ${scope}: ${safeText(sequence.divergenceNote)}`);
      }
      for (const t of sequence.callCountDeltas) {
        lines.push(
          `- ${inlineCode(t.name)} in ${scope}: median ${t.baseMedianCalls} call(s)/run on base → ` +
            `${t.headMedianCalls} on head — **${t.confidence}**`,
        );
      }
    }
    lines.push("");
  }

  if (subagents.length > 0) {
    lines.push("**Subagents**");
    lines.push("");
    for (const s of subagents) {
      const scope = s.evalName ? ` in eval ${inlineCode(s.evalName)}` : " (unattributed)";
      lines.push(
        `- ${inlineCode(s.name)}${scope}: used in ${s.baseUsedRuns} of ${s.baseTotalRuns} base runs → ` +
          `${s.headUsedRuns} of ${s.headTotalRuns} head runs — **${s.confidence}** ` +
          `(Fisher raw p=${formatPValue(s.pValue)}, Holm p=${formatPValue(s.adjustedPValue)})`,
      );
    }
    lines.push("");
  }

  if (toolInputs.length > 0) {
    lines.push("**Tool inputs**");
    lines.push("");
    for (const input of toolInputs) {
      const scope = input.evalName ? ` in eval ${inlineCode(input.evalName)}` : " (unattributed)";
      lines.push(
        `- ${inlineCode(input.toolName)} call ${input.occurrence}${scope}: input fingerprint changed — ` +
          `**${input.confidence}** across ${input.baseHashRuns} base / ${input.headHashRuns} head ` +
          "captured calls (raw inputs are never stored)",
      );
    }
    lines.push("");
  }

  if (finalOutputs.length > 0) {
    lines.push("**Final output**");
    lines.push("");
    for (const output of finalOutputs) {
      const captureChanged =
        output.baseCapturedRuns !== output.baseTotalRuns ||
        output.headCapturedRuns !== output.headTotalRuns;
      const lengths =
        output.baseLengths.length > 0 || output.headLengths.length > 0
          ? `; observed lengths ${output.baseLengths.join("/") || "?"} → ${output.headLengths.join("/") || "?"} chars`
          : "";
      const scope = output.evalName ? ` in eval ${inlineCode(output.evalName)}` : " (unattributed)";
      lines.push(
        `- output ${captureChanged ? "capture/fingerprint evidence changed" : "fingerprint changed"}${scope} — ` +
          `**${output.confidence}**; captured in ${output.baseCapturedRuns}/${output.baseTotalRuns} base ` +
          `and ${output.headCapturedRuns}/${output.headTotalRuns} head runs${lengths} ` +
          "(raw output is never stored)",
      );
    }
    lines.push("");
  }
}

function sequenceText(sequence: string[]): string {
  return sequence.length === 0 ? "(no tool calls)" : inlineCode(sequence.join(" → "));
}

function metricRow(
  label: string,
  metric: MetricDelta,
  fmt: (v: number) => string,
  unavailableNote: string,
): string {
  const baseCell = metric.base ? medianWithRange(metric.base, fmt) : "—";
  const headCell = metric.head ? medianWithRange(metric.head, fmt) : "—";
  const deltaCell =
    metric.deltaPct !== null
      ? formatSignedPct(metric.deltaPct)
      : metric.base === null || metric.head === null
        ? `unavailable (${unavailableNote})`
        : "n/a";
  return `| ${label} | ${baseCell} | ${headCell} | ${deltaCell} |`;
}

function renderRunTable(
  lines: string[],
  side: "base" | "head",
  ref: string,
  commitSha: string,
  summaries: RunSummary[],
): void {
  lines.push(`**${side} — ${inlineCode(ref)} @ ${inlineCode(shortSha(commitSha))}**`);
  lines.push("");
  lines.push("| Run | Evals passed | Tool calls | Skills loaded | Cost | Duration |");
  lines.push("| :-- | :-- | --: | :-- | --: | --: |");
  for (const run of summaries) {
    const skills =
      run.skillsLoaded.length > 0 ? run.skillsLoaded.map(inlineCode).join(", ") : "none";
    const cost = run.costUsd !== null && run.costUsd > 0 ? formatUsd(run.costUsd) : "—";
    lines.push(
      `| ${run.runIndex + 1} | ${run.evalsPassed}/${run.evalsTotal} | ${run.toolCallCount} | ` +
        `${skills} | ${cost} | ${formatDuration(run.durationMs)} |`,
    );
  }
  lines.push("");
}
