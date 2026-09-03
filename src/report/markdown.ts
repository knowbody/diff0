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
  MetricStats,
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

const VERDICT_CALLOUT: Record<
  DeltaReport["verdict"],
  { kind: "TIP" | "WARNING" | "CAUTION"; label: string }
> = {
  green: { kind: "TIP", label: "No review blockers found." },
  yellow: { kind: "WARNING", label: "Review recommended." },
  red: { kind: "CAUTION", label: "Regression detected." },
};

export function renderMarkdown(report: DeltaReport): string {
  const lines: string[] = [];
  const { meta } = report;
  const phrase = runsPhrase(meta);

  // Decision first: the default view should answer "can I merge this?" before
  // presenting the evidence. Complete statistics remain in the details block.
  lines.push(REPORT_MARKER);
  lines.push(`## diff0 report ${VERDICT_EMOJI[report.verdict]}`);
  lines.push("");
  const callout = VERDICT_CALLOUT[report.verdict];
  lines.push(`> [!${callout.kind}]`);
  lines.push(`> **${callout.label}** ${calloutSummary(report)}`);
  lines.push("");
  lines.push(comparisonLine(report));
  lines.push("");

  lines.push("### At a glance");
  lines.push("");
  renderOverview(report, lines);

  if (report.drift.hasDrift || report.drift.hasInconclusive) {
    lines.push("### Behavioral changes");
    lines.push("");
    renderDriftSummary(report, lines);
  }

  lines.push("### Eval results");
  lines.push("");
  lines.push("| Eval | Base | Head | Result |");
  lines.push("| :-- | :--: | :--: | :-- |");
  for (const e of report.evals) {
    lines.push(
      `| ${inlineCode(e.name)} | ${passCell(e.basePassed, e.baseTotal)} | ` +
        `${passCell(e.headPassed, e.headTotal)} | ${compactStatusCell(e)} |`,
    );
  }
  lines.push("");

  lines.push("<details>");
  lines.push("<summary><strong>Full comparison details</strong></summary>");
  lines.push("");

  lines.push("#### Run configuration");
  lines.push("");
  lines.push(validityLine(report));
  lines.push("");
  if (meta.mismatches.length > 0) {
    lines.push("**⚠️ Comparison validity warnings**");
    lines.push("");
    for (const mismatch of meta.mismatches) {
      lines.push(`- ${safeText(mismatch)}`);
    }
    lines.push("");
  }

  lines.push("#### Eval evidence");
  lines.push("");
  lines.push("| Eval | Base | Head | Statistical result |");
  lines.push("| :-- | :--: | :--: | :-- |");
  for (const e of report.evals) {
    lines.push(
      `| ${inlineCode(e.name)} | ${passCell(e.basePassed, e.baseTotal)} | ` +
        `${passCell(e.headPassed, e.headTotal)} | ${statusCell(e)} |`,
    );
  }
  lines.push("");

  lines.push("#### Behavioral evidence");
  lines.push("");
  if (!report.drift.hasDrift && !report.drift.hasInconclusive) {
    lines.push(`No behavioral drift detected across ${phrase}.`);
    lines.push("");
  } else {
    renderDrift(report, lines);
  }

  lines.push("#### Cost & performance");
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

  if (meta.gitDiffStat !== null) {
    lines.push("#### Changed files");
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

  lines.push("#### Per-run summaries");
  lines.push("");
  renderRunTable(lines, "base", meta.base.ref, meta.base.commitSha, report.runSummaries.base);
  renderRunTable(lines, "head", meta.head.ref, meta.head.commitSha, report.runSummaries.head);

  if (report.caveats.length > 0) {
    lines.push("#### Caveats");
    lines.push("");
    for (const caveat of report.caveats) {
      lines.push(`- ⚠️ ${safeText(caveat)}`);
    }
    lines.push("");
  }

  lines.push("</details>");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    `_Statistical comparison across ${phrase} — LLM runs are nondeterministic; ` +
      "treat proportions, not absolutes._",
  );

  return `${lines.join("\n")}\n`;
}

function calloutSummary(report: DeltaReport): string {
  if (report.verdict !== "yellow") return `${safeText(report.verdictSummary)}.`;
  return (
    `No confirmed eval regressions across ${runsPhrase(report.meta)}. ` +
    "Review the highlighted changes below."
  );
}

function comparisonLine(report: DeltaReport): string {
  const { meta } = report;
  return (
    `Comparing ${refLabel(meta.base.ref, meta.base.commitSha)} → ` +
    `${refLabel(meta.head.ref, meta.head.commitSha)} · ${runsPhrase(meta)} · ` +
    `model ${inlineCode(
      meta.base.model === meta.head.model
        ? meta.base.model
        : `${meta.base.model} → ${meta.head.model}`,
    )}`
  );
}

function refLabel(ref: string, commitSha: string): string {
  const display = /^[0-9a-f]{40}$/i.test(ref) ? shortSha(ref) : ref;
  const suffix = display === shortSha(commitSha) ? "" : ` (${shortSha(commitSha)})`;
  return inlineCode(`${display}${suffix}`);
}

function renderOverview(report: DeltaReport, lines: string[]): void {
  const basePassing = report.evals.filter(
    (evalDelta) => evalDelta.baseTotal > 0 && evalDelta.basePassed === evalDelta.baseTotal,
  ).length;
  const headPassing = report.evals.filter(
    (evalDelta) => evalDelta.headTotal > 0 && evalDelta.headPassed === evalDelta.headTotal,
  ).length;
  const evalDelta = headPassing - basePassing;
  const toolCalls = metricFromRuns(report.runSummaries.base, report.runSummaries.head);

  lines.push("| Signal | Base | Head | Change |");
  lines.push("| :-- | --: | --: | :-- |");
  lines.push(
    `| Passing evals | ${basePassing}/${report.evals.length} | ${headPassing}/${report.evals.length} | ` +
      `${evalDelta === 0 ? "unchanged" : `${evalDelta > 0 ? "+" : ""}${evalDelta}`} |`,
  );
  lines.push(metricRow("Tool calls / run", toolCalls, formatInt, "no run data"));
  if (report.costPerf.costUsd.base !== null && report.costPerf.costUsd.head !== null) {
    lines.push(metricRow("Cost / run", report.costPerf.costUsd, formatUsd, "no cost data"));
  }
  lines.push(
    metricRow("Output tokens / run", report.costPerf.tokensOut, formatInt, "no token data"),
  );
  lines.push(
    metricRow("Duration / run", report.costPerf.durationMs, formatDuration, "no timing data"),
  );
  lines.push("");
}

function metricFromRuns(base: RunSummary[], head: RunSummary[]): MetricDelta {
  const baseStats = stats(base.map((run) => run.toolCallCount));
  const headStats = stats(head.map((run) => run.toolCallCount));
  return {
    base: baseStats,
    head: headStats,
    deltaPct:
      baseStats !== null && headStats !== null && baseStats.median !== 0
        ? ((headStats.median - baseStats.median) / baseStats.median) * 100
        : null,
  };
}

function stats(values: number[]): MetricStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const first = sorted[0];
  if (first === undefined) return null;
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? first;
  const median = sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? upper) + upper) / 2 : upper;
  return { median, min: first, max: sorted[sorted.length - 1] ?? first };
}

interface EvidenceGroup<T extends { evalName: string | null }> {
  readonly item: T;
  readonly evalNames: Set<string>;
  unattributed: boolean;
}

function groupEvidence<T extends { evalName: string | null }>(
  items: T[],
  key: (item: T) => string,
): EvidenceGroup<T>[] {
  const groups = new Map<string, EvidenceGroup<T>>();
  for (const item of items) {
    const id = key(item);
    const existing = groups.get(id);
    if (existing) {
      if (item.evalName === null) existing.unattributed = true;
      else existing.evalNames.add(item.evalName);
      continue;
    }
    groups.set(id, {
      item,
      evalNames: new Set(item.evalName === null ? [] : [item.evalName]),
      unattributed: item.evalName === null,
    });
  }
  return [...groups.values()];
}

function evidenceScope(group: EvidenceGroup<{ evalName: string | null }>): string {
  if (group.unattributed && group.evalNames.size === 0) return "overall";
  if (group.unattributed) return `${group.evalNames.size} evals + overall`;
  const onlyEval = group.evalNames.values().next().value;
  if (group.evalNames.size === 1 && onlyEval !== undefined) return inlineCode(onlyEval);
  return `${group.evalNames.size} evals`;
}

function confidenceLabel(confidence: string | null): string {
  return confidence === "statistically-confirmed" ? "confirmed" : String(confidence);
}

function renderDriftSummary(report: DeltaReport, lines: string[]): void {
  const { skills, toolSequences, subagents, toolInputs, finalOutputs } = report.drift;
  lines.push("| Signal | Base | Head | Scope |");
  lines.push("| :-- | :-- | :-- | :-- |");

  for (const group of groupEvidence(
    skills,
    (item) =>
      `${item.name}\0${item.baseLoadedRuns}/${item.baseTotalRuns}\0${item.headLoadedRuns}/${item.headTotalRuns}\0${item.confidence}`,
  )) {
    const item = group.item;
    lines.push(
      `| Skill ${inlineCode(item.name)} | ${item.baseLoadedRuns}/${item.baseTotalRuns} runs | ` +
        `${item.headLoadedRuns}/${item.headTotalRuns} runs | ${evidenceScope(group)} · ${confidenceLabel(item.confidence)} |`,
    );
  }

  const divergentSequences = toolSequences.filter((item) => item.divergenceNote !== null);
  for (const group of groupEvidence(
    divergentSequences,
    (item) =>
      `${item.baseMostCommon.join("\0")}\u0001${item.baseMostCommonRuns}/${item.baseTotalRuns}\u0001` +
      `${item.headMostCommon.join("\0")}\u0001${item.headMostCommonRuns}/${item.headTotalRuns}\u0001${item.divergenceConfidence}`,
  )) {
    const item = group.item;
    lines.push(
      `| Tool path | ${sequenceText(item.baseMostCommon)} (${item.baseMostCommonRuns}/${item.baseTotalRuns}) | ` +
        `${sequenceText(item.headMostCommon)} (${item.headMostCommonRuns}/${item.headTotalRuns}) | ` +
        `${evidenceScope(group)} · ${confidenceLabel(item.divergenceConfidence)} |`,
    );
  }

  const toolCounts = toolSequences.flatMap((sequence) => sequence.callCountDeltas);
  for (const group of groupEvidence(
    toolCounts,
    (item) => `${item.name}\0${item.baseMedianCalls}\0${item.headMedianCalls}\0${item.confidence}`,
  )) {
    const item = group.item;
    lines.push(
      `| ${inlineCode(item.name)} calls | ${item.baseMedianCalls}/run | ${item.headMedianCalls}/run | ` +
        `${evidenceScope(group)} · ${confidenceLabel(item.confidence)} |`,
    );
  }

  for (const group of groupEvidence(
    subagents,
    (item) =>
      `${item.name}\0${item.baseUsedRuns}/${item.baseTotalRuns}\0${item.headUsedRuns}/${item.headTotalRuns}\0${item.confidence}`,
  )) {
    const item = group.item;
    lines.push(
      `| Subagent ${inlineCode(item.name)} | ${item.baseUsedRuns}/${item.baseTotalRuns} runs | ` +
        `${item.headUsedRuns}/${item.headTotalRuns} runs | ${evidenceScope(group)} · ${confidenceLabel(item.confidence)} |`,
    );
  }

  for (const group of groupEvidence(
    toolInputs,
    (item) =>
      `${item.toolName}\0${item.occurrence}\0${item.baseHashRuns}\0${item.headHashRuns}\0${item.confidence}`,
  )) {
    const item = group.item;
    lines.push(
      `| ${inlineCode(item.toolName)} input #${item.occurrence} changed | ${item.baseHashRuns} captured | ` +
        `${item.headHashRuns} captured | ${evidenceScope(group)} · ${confidenceLabel(item.confidence)} |`,
    );
  }

  for (const group of groupEvidence(
    finalOutputs,
    (item) =>
      `${item.baseCapturedRuns}/${item.baseTotalRuns}\0${item.headCapturedRuns}/${item.headTotalRuns}\0${item.confidence}`,
  )) {
    const item = group.item;
    lines.push(
      `| Final output changed | ${item.baseCapturedRuns}/${item.baseTotalRuns} captured | ` +
        `${item.headCapturedRuns}/${item.headTotalRuns} captured | ${evidenceScope(group)} · ${confidenceLabel(item.confidence)} |`,
    );
  }
  lines.push("");
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

function compactStatusCell(e: EvalDelta): string {
  let cell = STATUS_TEXT[e.status];
  if (e.softScores && e.softScores.delta !== 0) {
    const sign = e.softScores.delta >= 0 ? "+" : "";
    cell += ` · score ${e.softScores.baseMedian} → ${e.softScores.headMedian} (${sign}${e.softScores.delta})`;
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
  return cell;
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
