/**
 * Terminal renderer — same content as the markdown report, compact and
 * column-aligned. Colors via picocolors; pass { color: false } for CI logs
 * and tests (no ANSI codes emitted).
 */
import picocolors from "picocolors";
import type {
  DeltaReport,
  EvalDelta,
  EvalStatus,
  MetricDelta,
  PerformanceRegression,
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

type Colors = ReturnType<typeof picocolors.createColors>;

export interface TerminalOptions {
  color?: boolean;
}

/**
 * Soft wrap budget: keeps every rendered line readable in a 100-column
 * terminal (the narrowest target we format for — demo recordings, CI logs)
 * with a little slack. Wrapping only, never truncation — the terminal render
 * keeps full fidelity with the markdown/json reports.
 */
const MAX_LINE_WIDTH = 96;

function safeTerminalText(value: string): string {
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
    .join("");
}

/**
 * Greedy token wrap: tokens are joined with single spaces; a token that
 * would push the line past MAX_LINE_WIDTH starts a continuation line
 * prefixed with contIndent (hanging indent). Tokens are never split.
 */
function wrapTokens(tokens: string[], firstIndent: string, contIndent: string): string[] {
  const lines: string[] = [];
  let current = firstIndent;
  let hasToken = false;
  for (const token of tokens) {
    let remaining = token;
    if (hasToken && `${current} ${remaining}`.length > MAX_LINE_WIDTH) {
      lines.push(current);
      current = contIndent;
      hasToken = false;
    }
    const separator = hasToken ? " " : "";
    const available = MAX_LINE_WIDTH - current.length - separator.length;
    if (remaining.length > available) {
      if (available > 0) {
        lines.push(`${current}${separator}${remaining.slice(0, available)}`);
        remaining = remaining.slice(available);
      }
      while (remaining.length > MAX_LINE_WIDTH - contIndent.length) {
        const width = MAX_LINE_WIDTH - contIndent.length;
        lines.push(`${contIndent}${remaining.slice(0, width)}`);
        remaining = remaining.slice(width);
      }
      current = `${contIndent}${remaining}`;
      hasToken = remaining.length > 0;
    } else {
      current = hasToken ? `${current} ${remaining}` : `${current}${remaining}`;
      hasToken = true;
    }
  }
  if (hasToken || lines.length === 0) lines.push(current);
  return lines;
}

/** Word-wrap plain (uncolored) text; color per returned line if needed. */
function wrapText(text: string, firstIndent: string, contIndent: string): string[] {
  return wrapTokens(text.split(" "), firstIndent, contIndent);
}

/**
 * Pack `sep`-joined segments into lines of at most MAX_LINE_WIDTH,
 * breaking only at segment boundaries (used for the validity line).
 */
function packSegments(segments: string[], sep: string, contIndent: string): string[] {
  const lines: string[] = [];
  let current = "";
  for (const segment of segments) {
    if (current === "") {
      current = segment;
    } else if (`${current}${sep}${segment}`.length > MAX_LINE_WIDTH) {
      lines.push(current);
      current = `${contIndent}${segment}`;
    } else {
      current = `${current}${sep}${segment}`;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

const STATUS_PLAIN: Record<EvalStatus, string> = {
  pass: "pass",
  regressed: "REGRESSED",
  improved: "improved",
  fail: "failing (both refs)",
  "flaky-base": "flaky (base)",
  "flaky-head": "flaky (head)",
  "flaky-both": "flaky (base + head)",
  "inconclusive-regression": "lower pass rate (inconclusive)",
  "inconclusive-improvement": "higher pass rate (inconclusive)",
  "partial-base": "incomplete coverage (base)",
  "partial-head": "incomplete coverage (head)",
  "partial-both": "incomplete coverage (base + head)",
  "missing-base": "added",
  "missing-head": "removed",
};

export function renderTerminal(report: DeltaReport, opts: TerminalOptions = {}): string {
  const pc = picocolors.createColors(opts.color ?? true);
  const lines: string[] = [];
  const { meta } = report;
  const phrase = runsPhrase(meta);

  // Title + verdict. The verdict line is the headline: when the one-line
  // form would overflow MAX_LINE_WIDTH, keep `diff0 base...head  VERDICT`
  // intact and wrap the summary onto its own indented line(s).
  const verdictLabel = { green: "GREEN", yellow: "YELLOW", red: "RED" }[report.verdict];
  const verdictColor = { green: pc.green, yellow: pc.yellow, red: pc.red }[report.verdict];
  const baseRef = safeTerminalText(meta.base.ref);
  const headRef = safeTerminalText(meta.head.ref);
  const verdictSummary = safeTerminalText(report.verdictSummary);
  const headline = `${pc.bold("diff0")} ${baseRef}...${headRef}  ${verdictColor(pc.bold(verdictLabel))}`;
  const plainTitle = `diff0 ${baseRef}...${headRef}  ${verdictLabel} — ${verdictSummary}`;
  if (
    headline.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g"), "").length >
    MAX_LINE_WIDTH
  ) {
    lines.push(...wrapText(`diff0 ${baseRef}...${headRef}  ${verdictLabel}`, "", "  "));
    lines.push(...wrapText(`— ${verdictSummary}`, "  ", "    "));
  } else if (plainTitle.length <= MAX_LINE_WIDTH) {
    lines.push(`${headline} — ${verdictSummary}`);
  } else {
    lines.push(headline);
    lines.push(...wrapText(`— ${verdictSummary}`, "  ", "    "));
  }

  // Validity line — packed at " | " boundaries so it never overflows.
  const inferred = meta.base.sandboxInferred ? " (inferred)" : "";
  const sandboxSegments =
    meta.hostDefaultSandboxCandidate !== undefined
      ? [
          meta.base.sandboxBackend === meta.head.sandboxBackend
            ? `actual sandbox ${safeTerminalText(String(meta.base.sandboxBackend))}`
            : `actual sandbox base ${safeTerminalText(String(meta.base.sandboxBackend))} / head ${safeTerminalText(String(meta.head.sandboxBackend))}`,
          `host default candidate ${safeTerminalText(String(meta.hostDefaultSandboxCandidate))}`,
        ]
      : [
          meta.base.sandboxBackend === meta.head.sandboxBackend
            ? `sandbox ${safeTerminalText(String(meta.base.sandboxBackend))}${inferred}`
            : `sandbox base ${safeTerminalText(String(meta.base.sandboxBackend))} / head ${safeTerminalText(String(meta.head.sandboxBackend))}${inferred}`,
        ];
  const validitySegments = [
    meta.base.eveVersion === meta.head.eveVersion
      ? `eve ${safeTerminalText(meta.base.eveVersion)}`
      : `eve base ${safeTerminalText(meta.base.eveVersion)} / head ${safeTerminalText(meta.head.eveVersion)}`,
    meta.base.model === meta.head.model
      ? `model ${safeTerminalText(meta.base.model)}`
      : `model base ${safeTerminalText(meta.base.model)} / head ${safeTerminalText(meta.head.model)}`,
    phrase,
    ...sandboxSegments,
    meta.totalComparisonCostUsd !== null
      ? `comparison cost ${formatUsd(meta.totalComparisonCostUsd)} (${meta.costSource})`
      : "comparison cost unavailable",
  ];
  for (const line of packSegments(validitySegments, " | ", "  ")) {
    lines.push(...wrapText(line, "", "  ").map((wrapped) => pc.dim(wrapped)));
  }

  if (meta.mismatches.length > 0) {
    lines.push("");
    lines.push(pc.yellow(pc.bold("COMPARISON VALIDITY WARNINGS")));
    for (const mismatch of meta.mismatches) {
      lines.push(
        ...wrapText(safeTerminalText(mismatch), "  ! ", "    ").map((line) => pc.yellow(line)),
      );
    }
  }

  // Evals
  lines.push("");
  lines.push(pc.bold("EVALS"));
  const nameWidth = Math.max(4, ...report.evals.map((e) => safeTerminalText(e.name).length));
  const baseWidth = Math.max(
    4,
    ...report.evals.map((e) => passCell(e.basePassed, e.baseTotal).length),
  );
  const headWidth = Math.max(
    4,
    ...report.evals.map((e) => passCell(e.headPassed, e.headTotal).length),
  );
  for (const e of report.evals) {
    const status = colorStatus(e.status, pc);
    const extras = evalExtras(e);
    const prefix =
      `  ${safeTerminalText(e.name).padEnd(nameWidth)}  base ${passCell(e.basePassed, e.baseTotal).padEnd(baseWidth)}` +
      `  head ${passCell(e.headPassed, e.headTotal).padEnd(headWidth)}  `;
    const plainMain = `${prefix}${STATUS_PLAIN[e.status]}`;
    if (plainMain.length <= MAX_LINE_WIDTH) {
      lines.push(`${prefix}${status}`);
    } else {
      lines.push(...wrapText(plainMain, "", "    "));
    }
    if (extras !== "") {
      lines.push(
        ...wrapText(extras.trim().replace(/^\[|\]$/g, ""), "    [", "     ").map(
          (line, index, wrapped) => (index === wrapped.length - 1 ? `${line}]` : line),
        ),
      );
    }
  }

  // Drift
  lines.push("");
  lines.push(pc.bold("BEHAVIORAL DRIFT"));
  if (!report.drift.hasDrift && !report.drift.hasInconclusive) {
    lines.push(`  No behavioral drift detected across ${phrase}.`);
  } else {
    renderDrift(report, lines, pc);
  }

  // Cost & performance
  lines.push("");
  lines.push(pc.bold("COST & PERFORMANCE"));
  const rows: Array<[string, string, string, string]> = [
    metricRow("cost/session", report.costPerf.costUsd, formatUsd),
    metricRow("uncached input tokens", report.costPerf.tokensIn, formatInt),
    metricRow("tokens out", report.costPerf.tokensOut, formatInt),
    metricRow("cache-read tokens", report.costPerf.cacheReadTokens, formatInt),
    metricRow("cache-write tokens", report.costPerf.cacheWriteTokens, formatInt),
    metricRow("duration", report.costPerf.durationMs, formatDuration),
  ];
  const labelWidth = Math.max(...rows.map((r) => r[0].length));
  const baseColWidth = Math.max(...rows.map((r) => r[1].length));
  const headColWidth = Math.max(...rows.map((r) => r[2].length));
  for (const [label, baseCell, headCell, deltaCell] of rows) {
    lines.push(
      `  ${label.padEnd(labelWidth)}  base ${baseCell.padEnd(baseColWidth)}  ` +
        `head ${headCell.padEnd(headColWidth)}  ${deltaCell}`,
    );
  }
  if (report.costPerf.regressions.length > 0) {
    lines.push(pc.yellow(pc.bold("  EXCEEDED PERFORMANCE BUDGETS")));
    for (const regression of report.costPerf.regressions) {
      lines.push(pc.yellow(`  ! ${performanceBudgetText(regression)}`));
    }
  }

  // Changed files
  if (meta.gitDiffStat !== null) {
    lines.push("");
    lines.push(pc.bold("CHANGED FILES"));
    for (const file of meta.gitDiffStat.files) {
      lines.push(
        ...wrapText(
          `${safeTerminalText(file.path)} (+${file.insertions} -${file.deletions})`,
          "  ",
          "    ",
        ),
      );
    }
    lines.push(
      ...wrapText(
        `${safeTerminalText(meta.gitDiffStat.summary)}. File attribution is correlational, not causal.`,
        "  ",
        "    ",
      ).map((line) => pc.dim(line)),
    );
  }

  // Per-run summaries
  lines.push("");
  lines.push(pc.bold("PER-RUN RAW SUMMARIES"));
  renderRuns(lines, "base", meta.base.ref, meta.base.commitSha, report.runSummaries.base, pc);
  renderRuns(lines, "head", meta.head.ref, meta.head.commitSha, report.runSummaries.head, pc);

  // Caveats + footer
  if (report.caveats.length > 0) {
    lines.push("");
    for (const caveat of report.caveats) {
      lines.push(
        ...wrapText(safeTerminalText(caveat), "  ! ", "    ").map((line) => pc.yellow(line)),
      );
    }
  }
  // Footer: two fixed lines (split at the em dash) so the sign-off never
  // overflows a 100-column terminal regardless of the runs phrase.
  lines.push("");
  lines.push(pc.dim(`Statistical comparison across ${phrase} —`));
  lines.push(pc.dim("LLM runs are nondeterministic; treat proportions, not absolutes."));

  return `${lines.join("\n")}\n`;
}

const PERFORMANCE_LABELS: Record<PerformanceRegression["metric"], string> = {
  costUsd: "cost/session",
  tokensIn: "uncached input tokens",
  tokensOut: "output tokens",
  durationMs: "duration",
};

function performanceBudgetText(regression: PerformanceRegression): string {
  return (
    `${PERFORMANCE_LABELS[regression.metric]} delta ${formatSignedPct(regression.deltaPct)} ` +
    `exceeds ${formatSignedPct(regression.thresholdPct)} threshold`
  );
}

function colorStatus(status: EvalStatus, pc: Colors): string {
  const text = STATUS_PLAIN[status];
  switch (status) {
    case "regressed":
      return pc.red(pc.bold(text));
    case "improved":
      return pc.green(text);
    case "fail":
      return pc.red(text);
    case "flaky-base":
    case "flaky-head":
    case "flaky-both":
    case "inconclusive-regression":
    case "inconclusive-improvement":
    case "partial-base":
    case "partial-head":
    case "partial-both":
      return pc.yellow(text);
    case "pass":
      return pc.green(text);
    default:
      return text;
  }
}

function evalExtras(e: EvalDelta): string {
  const extras: string[] = [];
  if (e.softScores) {
    const sign = e.softScores.delta >= 0 ? "+" : "";
    extras.push(
      `score ${e.softScores.baseMedian} -> ${e.softScores.headMedian} (${sign}${e.softScores.delta})`,
    );
    if (e.softScores.classification === "material-regression") {
      extras.push(`material score regression (threshold -${e.softScores.materialThreshold})`);
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
    extras.push(`coverage ${coverage.join(", ")}`);
  }
  if (e.twoProportionHint) {
    extras.push(`hint: ${e.twoProportionHint.note}`);
  }
  if (e.statisticalEvidence.pValue !== null) {
    extras.push(
      `Fisher raw p=${formatPValue(e.statisticalEvidence.pValue)}; ` +
        `Holm p=${formatPValue(e.statisticalEvidence.adjustedPValue as number)}`,
    );
  }
  return extras.length > 0 ? `  [${extras.join("; ")}]` : "";
}

function formatPValue(value: number): string {
  return value < 0.0001 ? "<0.0001" : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function renderDrift(report: DeltaReport, lines: string[], pc: Colors): void {
  const { skills, toolSequences, subagents, toolInputs, finalOutputs } = report.drift;
  if (skills.length > 0) {
    lines.push("  skills:");
    for (const s of skills) {
      const scope = s.evalName ? ` in eval ${safeTerminalText(s.evalName)}` : " (unattributed)";
      lines.push(
        ...wrapText(
          `${safeTerminalText(s.name)}${scope}: loaded in ${s.baseLoadedRuns} of ${s.baseTotalRuns} base runs -> ` +
            `${s.headLoadedRuns} of ${s.headTotalRuns} head runs [${s.confidence}; ` +
            `Fisher raw p=${formatPValue(s.pValue)}; Holm p=${formatPValue(s.adjustedPValue)}]`,
          "    ",
          "      ",
        ),
      );
    }
  }
  if (toolSequences.length > 0) {
    lines.push("  tool sequences:");
    for (const sequence of toolSequences) {
      const scope = sequence.evalName
        ? `eval ${safeTerminalText(sequence.evalName)}`
        : "unattributed calls";
      if (sequence.divergenceNote !== null) {
        lines.push(
          ...sequenceLines(
            `${scope}, base most common (in ${sequence.baseMostCommonRuns} of ` +
              `${sequence.baseTotalRuns} runs):`,
            sequence.baseMostCommon,
          ),
        );
        lines.push(
          ...sequenceLines(
            `${scope}, head most common (in ${sequence.headMostCommonRuns} of ` +
              `${sequence.headTotalRuns} runs):`,
            sequence.headMostCommon,
          ),
        );
        lines.push(
          ...wrapText(
            `${scope}: ${safeTerminalText(sequence.divergenceNote)}`,
            "    ",
            "      ",
          ).map((line) => pc.yellow(line)),
        );
      }
      for (const t of sequence.callCountDeltas) {
        lines.push(
          ...wrapText(
            `${safeTerminalText(t.name)} in ${scope}: median ${t.baseMedianCalls} call(s)/run on base -> ` +
              `${t.headMedianCalls} on head [${t.confidence}]`,
            "    ",
            "      ",
          ),
        );
      }
    }
  }
  if (subagents.length > 0) {
    lines.push("  subagents:");
    for (const s of subagents) {
      const scope = s.evalName ? ` in eval ${safeTerminalText(s.evalName)}` : " (unattributed)";
      lines.push(
        ...wrapText(
          `${safeTerminalText(s.name)}${scope}: used in ${s.baseUsedRuns} of ${s.baseTotalRuns} base runs -> ` +
            `${s.headUsedRuns} of ${s.headTotalRuns} head runs [${s.confidence}; ` +
            `Fisher raw p=${formatPValue(s.pValue)}; Holm p=${formatPValue(s.adjustedPValue)}]`,
          "    ",
          "      ",
        ),
      );
    }
  }
  if (toolInputs.length > 0) {
    lines.push("  tool inputs:");
    for (const input of toolInputs) {
      const scope = input.evalName
        ? ` in eval ${safeTerminalText(input.evalName)}`
        : " (unattributed)";
      lines.push(
        ...wrapText(
          `${safeTerminalText(input.toolName)} call ${input.occurrence}${scope}: input fingerprint changed ` +
            `[${input.confidence}; ${input.baseHashRuns} base / ${input.headHashRuns} head captured; ` +
            "raw inputs not stored]",
          "    ",
          "      ",
        ),
      );
    }
  }
  for (const output of finalOutputs) {
    const captureChanged =
      output.baseCapturedRuns !== output.baseTotalRuns ||
      output.headCapturedRuns !== output.headTotalRuns;
    const lengths =
      output.baseLengths.length > 0 || output.headLengths.length > 0
        ? `; lengths ${output.baseLengths.join("/") || "?"} -> ${output.headLengths.join("/") || "?"} chars`
        : "";
    const scope = output.evalName
      ? ` in eval ${safeTerminalText(output.evalName)}`
      : " (unattributed)";
    lines.push(
      ...wrapText(
        `final output${scope}: ${captureChanged ? "capture/fingerprint evidence changed" : "fingerprint changed"} ` +
          `[${output.confidence}; captured ${output.baseCapturedRuns}/${output.baseTotalRuns} base, ` +
          `${output.headCapturedRuns}/${output.headTotalRuns} head${lengths}; raw output not stored]`,
        "  ",
        "    ",
      ),
    );
  }
}

/**
 * A `label: tool -> tool -> ...` drift line, wrapped with a hanging indent
 * so long sequences stay inside MAX_LINE_WIDTH. Breaks only between calls
 * ("tool ->" stays atomic), so every continuation line starts on a tool name.
 */
function sequenceLines(label: string, sequence: string[]): string[] {
  const safeLabel = safeTerminalText(label);
  if (sequence.length === 0) return wrapText(`${safeLabel} (no tool calls)`, "    ", "      ");
  const tokens = sequence.map((tool, i) => {
    const safeTool = safeTerminalText(tool);
    return i < sequence.length - 1 ? `${safeTool} ->` : safeTool;
  });
  return [...wrapText(safeLabel, "    ", "      "), ...wrapTokens(tokens, "      ", "      ")];
}

function metricRow(
  label: string,
  metric: MetricDelta,
  fmt: (v: number) => string,
): [string, string, string, string] {
  const baseCell = metric.base ? medianWithRange(metric.base, fmt) : "unavailable";
  const headCell = metric.head ? medianWithRange(metric.head, fmt) : "unavailable";
  const deltaCell = metric.deltaPct !== null ? formatSignedPct(metric.deltaPct) : "n/a";
  return [label, baseCell, headCell, deltaCell];
}

function renderRuns(
  lines: string[],
  side: "base" | "head",
  ref: string,
  commitSha: string,
  summaries: RunSummary[],
  pc: Colors,
): void {
  lines.push(
    ...wrapText(
      `${side} ${safeTerminalText(ref)} @ ${safeTerminalText(shortSha(commitSha))}`,
      "  ",
      "    ",
    ).map((line) => (line.startsWith(`  ${side} `) ? line.replace(side, pc.bold(side)) : line)),
  );
  for (const run of summaries) {
    const skills =
      run.skillsLoaded.length > 0 ? run.skillsLoaded.map(safeTerminalText).join(", ") : "none";
    const cost = run.costUsd !== null && run.costUsd > 0 ? formatUsd(run.costUsd) : "cost n/a";
    lines.push(
      ...wrapText(
        `run ${run.runIndex + 1}: ${run.evalsPassed}/${run.evalsTotal} evals passed, ` +
          `${run.toolCallCount} tool calls (agents excluded), skills: ${skills}, ${cost}, ` +
          `${formatDuration(run.durationMs)}`,
        "    ",
        "      ",
      ),
    );
  }
}
