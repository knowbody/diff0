import { median, round, sequencesEqual } from "../numeric.js";
import type { RunRecord } from "../types.js";
import { DRIFT_ALPHA } from "./constants.js";
import { fisherExactTwoSided, holmAdjusted } from "./statistics.js";
import type {
  DriftSection,
  FinalOutputDelta,
  SkillDrift,
  SubagentDrift,
  ToolCountDelta,
  ToolInputDelta,
  ToolSequenceDrift,
} from "./types.js";

function runsContaining(runs: RunRecord[], pick: (r: RunRecord) => string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const run of runs) {
    for (const name of new Set(pick(run))) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

function proportionDrift(
  baseCounts: Map<string, number>,
  headCounts: Map<string, number>,
  baseN: number,
  headN: number,
): Array<{
  name: string;
  baseRuns: number;
  headRuns: number;
  changed: boolean;
  pValue: number;
}> {
  const names = [...new Set([...baseCounts.keys(), ...headCounts.keys()])].sort();
  const out: Array<{
    name: string;
    baseRuns: number;
    headRuns: number;
    changed: boolean;
    pValue: number;
  }> = [];
  for (const name of names) {
    const b = baseCounts.get(name) ?? 0;
    const h = headCounts.get(name) ?? 0;
    // Compare as fractions (cross-multiplied) so differing N still compares fairly.
    const changed = b * headN !== h * baseN;
    out.push({
      name,
      baseRuns: b,
      headRuns: h,
      changed,
      // Unchanged observations still belong to the predetermined family.
      pValue: changed ? fisherExactTwoSided(b, baseN, h, headN) : 1,
    });
  }
  return out;
}

function scopedRuns(runs: RunRecord[], evalName: string | null): RunRecord[] {
  if (evalName === null) return runs;
  return runs.filter((run) => run.evalResults.some((result) => result.name === evalName));
}

function toolSequence(run: RunRecord, evalName: string | null): string[] {
  return [...run.toolCalls]
    .filter((call) => (call.evalName ?? null) === evalName)
    .sort((a, b) => a.order - b.order)
    .map((call) => call.name);
}

function mostCommonSequence(
  runs: RunRecord[],
  evalName: string | null,
): {
  sequence: string[];
  count: number;
  tied: boolean;
} {
  const counts = new Map<string, { sequence: string[]; count: number; firstSeen: number }>();
  runs.forEach((run, index) => {
    const sequence = toolSequence(run, evalName);
    const key = sequence.join("\u0000");
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { sequence, count: 1, firstSeen: index });
    }
  });
  let best: { sequence: string[]; count: number; firstSeen: number } | null = null;
  for (const entry of counts.values()) {
    if (
      !best ||
      entry.count > best.count ||
      (entry.count === best.count && entry.firstSeen < best.firstSeen)
    ) {
      best = entry;
    }
  }
  // runs is never empty (computeDelta validates), so best is always set.
  if (!best) return { sequence: [], count: 0, tied: false };
  const tied = [...counts.values()].filter((entry) => entry.count === best?.count).length > 1;
  return { sequence: best.sequence, count: best.count, tied };
}

function toolCallCounts(run: RunRecord, evalName: string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const call of run.toolCalls) {
    if ((call.evalName ?? null) !== evalName) continue;
    counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
  }
  return counts;
}

function toolCountDeltas(
  baseRuns: RunRecord[],
  headRuns: RunRecord[],
  evalName: string | null,
): ToolCountDelta[] {
  const perRunBase = baseRuns.map((run) => toolCallCounts(run, evalName));
  const perRunHead = headRuns.map((run) => toolCallCounts(run, evalName));
  const names = new Set<string>();
  for (const counts of [...perRunBase, ...perRunHead]) {
    for (const name of counts.keys()) names.add(name);
  }
  const out: ToolCountDelta[] = [];
  for (const name of [...names].sort()) {
    const baseMedianCalls = median(perRunBase.map((c) => c.get(name) ?? 0));
    const headMedianCalls = median(perRunHead.map((c) => c.get(name) ?? 0));
    if (baseMedianCalls !== headMedianCalls) {
      const baseValues = perRunBase.map((c) => c.get(name) ?? 0);
      const headValues = perRunHead.map((c) => c.get(name) ?? 0);
      const rangesDoNotOverlap =
        Math.max(...baseValues) < Math.min(...headValues) ||
        Math.max(...headValues) < Math.min(...baseValues);
      out.push({
        evalName,
        name,
        baseMedianCalls,
        headMedianCalls,
        confidence:
          baseRuns.length >= 2 && headRuns.length >= 2 && rangesDoNotOverlap
            ? "stable"
            : "inconclusive",
      });
    }
  }
  return out;
}

function alignedToolInputs(runs: RunRecord[]): Map<string, Array<string | null>> {
  const allKeys = new Set<string>();
  const perRun = runs.map((run) => {
    const observed = new Map<string, string>();
    const occurrences = new Map<string, number>();
    for (const call of [...run.toolCalls].sort((a, b) => a.order - b.order)) {
      const scope = call.evalName ?? "";
      const counterKey = `${scope}\u0000${call.name}`;
      const occurrence = (occurrences.get(counterKey) ?? 0) + 1;
      occurrences.set(counterKey, occurrence);
      const key = `${scope}\u0000${call.name}\u0000${occurrence}`;
      observed.set(key, call.inputsHash);
      allKeys.add(key);
    }
    return observed;
  });
  const result = new Map<string, Array<string | null>>();
  for (const key of allKeys)
    result.set(
      key,
      perRun.map((run) => run.get(key) ?? null),
    );
  return result;
}

function distinctPresent(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))].sort();
}

function fingerprintFrequencies(
  values: Array<string | null>,
): Array<{ hash: string; runs: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([hash, runs]) => ({ hash, runs }));
}

function sameFingerprintDistribution(
  base: Array<{ hash: string; runs: number }>,
  head: Array<{ hash: string; runs: number }>,
): boolean {
  const baseTotal = base.reduce((total, item) => total + item.runs, 0);
  const headTotal = head.reduce((total, item) => total + item.runs, 0);
  if (baseTotal === 0 || headTotal === 0) return false;
  const baseCounts = new Map(base.map((item) => [item.hash, item.runs]));
  const headCounts = new Map(head.map((item) => [item.hash, item.runs]));
  const hashes = new Set([...baseCounts.keys(), ...headCounts.keys()]);
  return [...hashes].every(
    (hash) => (baseCounts.get(hash) ?? 0) * headTotal === (headCounts.get(hash) ?? 0) * baseTotal,
  );
}

function toolInputDeltas(baseRuns: RunRecord[], headRuns: RunRecord[]): ToolInputDelta[] {
  const base = alignedToolInputs(baseRuns);
  const head = alignedToolInputs(headRuns);
  const keys = [...new Set([...base.keys(), ...head.keys()])].sort();
  const out: ToolInputDelta[] = [];
  for (const key of keys) {
    const baseValues = base.get(key) ?? baseRuns.map(() => null);
    const headValues = head.get(key) ?? headRuns.map(() => null);
    const baseHashes = distinctPresent(baseValues);
    const headHashes = distinctPresent(headValues);
    const baseFrequencies = fingerprintFrequencies(baseValues);
    const headFrequencies = fingerprintFrequencies(headValues);
    const baseHashRuns = baseFrequencies.reduce((total, item) => total + item.runs, 0);
    const headHashRuns = headFrequencies.reduce((total, item) => total + item.runs, 0);
    // Added/removed calls are already represented by sequence/count drift.
    if (
      baseHashes.length === 0 ||
      headHashes.length === 0 ||
      sameFingerprintDistribution(baseFrequencies, headFrequencies)
    ) {
      continue;
    }
    const [scope = "", toolName = "", occurrenceText = "1"] = key.split("\u0000");
    const stableAndRepeated =
      baseRuns.length >= 2 &&
      headRuns.length >= 2 &&
      baseValues.every((value) => value === baseValues[0] && value !== null) &&
      headValues.every((value) => value === headValues[0] && value !== null);
    out.push({
      evalName: scope === "" ? null : scope,
      toolName,
      occurrence: Number(occurrenceText),
      baseHashes,
      headHashes,
      baseFrequencies,
      headFrequencies,
      baseHashRuns,
      headHashRuns,
      confidence: stableAndRepeated ? "stable" : "inconclusive",
    });
  }
  return out;
}

function finalOutputDelta(
  baseRuns: RunRecord[],
  headRuns: RunRecord[],
  evalName: string | null,
): FinalOutputDelta | null {
  const fingerprint = (run: RunRecord) =>
    evalName === null
      ? run.finalOutput
      : run.evalResults.find((result) => result.name === evalName)?.finalOutput;
  const baseFingerprints = baseRuns.map(fingerprint).filter((value) => value !== undefined);
  const headFingerprints = headRuns.map(fingerprint).filter((value) => value !== undefined);
  const absentRuns = (runs: RunRecord[]) =>
    evalName === null
      ? 0
      : runs.filter((run) => {
          const result = run.evalResults.find((result) => result.name === evalName);
          return result?.finalOutputAbsent === true && result.finalOutput === undefined;
        }).length;
  const baseAbsentRuns = absentRuns(baseRuns);
  const headAbsentRuns = absentRuns(headRuns);
  if (baseFingerprints.length === 0 && headFingerprints.length === 0) {
    // Preserve legacy runs without capture support, but distinguish known absence
    // from missing evidence when either side explicitly reports absence.
    if (baseAbsentRuns === 0 && headAbsentRuns === 0) return null;
    if (baseAbsentRuns === baseRuns.length && headAbsentRuns === headRuns.length) return null;
  }
  const baseHashes = [...new Set(baseFingerprints.map((value) => value.hash))].sort();
  const headHashes = [...new Set(headFingerprints.map((value) => value.hash))].sort();
  const baseFrequencies = fingerprintFrequencies(baseFingerprints.map((value) => value.hash));
  const headFrequencies = fingerprintFrequencies(headFingerprints.map((value) => value.hash));
  if (
    sameFingerprintDistribution(baseFrequencies, headFrequencies) &&
    baseFingerprints.length === baseRuns.length &&
    headFingerprints.length === headRuns.length
  ) {
    return null;
  }
  const baseLengths = [...new Set(baseFingerprints.flatMap((value) => value.length ?? []))].sort(
    (a, b) => a - b,
  );
  const headLengths = [...new Set(headFingerprints.flatMap((value) => value.length ?? []))].sort(
    (a, b) => a - b,
  );
  const stableAndRepeated =
    baseFingerprints.length + baseAbsentRuns === baseRuns.length &&
    headFingerprints.length + headAbsentRuns === headRuns.length &&
    baseRuns.length >= 2 &&
    headRuns.length >= 2 &&
    baseHashes.length + Number(baseAbsentRuns > 0) === 1 &&
    headHashes.length + Number(headAbsentRuns > 0) === 1;
  return {
    evalName,
    baseAbsentRuns,
    headAbsentRuns,
    baseCapturedRuns: baseFingerprints.length,
    baseTotalRuns: baseRuns.length,
    headCapturedRuns: headFingerprints.length,
    headTotalRuns: headRuns.length,
    baseHashes,
    headHashes,
    baseFrequencies,
    headFrequencies,
    baseLengths,
    headLengths,
    confidence: stableAndRepeated ? "stable" : "inconclusive",
  };
}

function commonEvalNames(baseRuns: RunRecord[], headRuns: RunRecord[]): string[] {
  const base = new Set(baseRuns.flatMap((run) => run.evalResults.map((result) => result.name)));
  const head = new Set(headRuns.flatMap((run) => run.evalResults.map((result) => result.name)));
  return [...base].filter((name) => head.has(name)).sort();
}

type SkillDriftHypothesis = SkillDrift & { changed: boolean; rawPValue: number };
type SubagentDriftHypothesis = SubagentDrift & { changed: boolean; rawPValue: number };

/** The same occurrence hypothesis family covers skill loads and subagent delegations. */
function occurrenceHypotheses(
  baseRuns: RunRecord[],
  headRuns: RunRecord[],
  evalNames: string[],
  pick: (run: RunRecord) => Array<{ name: string; evalName?: string }>,
) {
  const scopes: Array<string | null> = [
    ...evalNames,
    ...([...baseRuns, ...headRuns].some((run) =>
      pick(run).some((item) => item.evalName === undefined),
    )
      ? [null]
      : []),
  ];
  return scopes.flatMap((evalName) => {
    const base = scopedRuns(baseRuns, evalName);
    const head = scopedRuns(headRuns, evalName);
    const names = (run: RunRecord) =>
      pick(run)
        .filter((item) => (item.evalName ?? null) === evalName)
        .map((item) => item.name);
    return proportionDrift(
      runsContaining(base, names),
      runsContaining(head, names),
      base.length,
      head.length,
    ).map((delta) => ({
      evalName,
      name: delta.name,
      baseOccurrences: delta.baseRuns,
      baseTotalRuns: base.length,
      headOccurrences: delta.headRuns,
      headTotalRuns: head.length,
      confidence: "inconclusive" as const,
      pValue: delta.pValue,
      adjustedPValue: delta.pValue,
      changed: delta.changed,
      rawPValue: delta.pValue,
    }));
  });
}

export function computeDrift(baseRuns: RunRecord[], headRuns: RunRecord[]): DriftSection {
  const evalNames = commonEvalNames(baseRuns, headRuns);
  const skillHypotheses: SkillDriftHypothesis[] = occurrenceHypotheses(
    baseRuns,
    headRuns,
    evalNames,
    (run) => run.skillLoads,
  ).map(({ baseOccurrences, headOccurrences, ...hypothesis }) => ({
    ...hypothesis,
    baseLoadedRuns: baseOccurrences,
    headLoadedRuns: headOccurrences,
  }));
  const subagentHypotheses: SubagentDriftHypothesis[] = occurrenceHypotheses(
    baseRuns,
    headRuns,
    evalNames,
    (run) => run.subagentCalls,
  ).map(({ baseOccurrences, headOccurrences, ...hypothesis }) => ({
    ...hypothesis,
    baseUsedRuns: baseOccurrences,
    headUsedRuns: headOccurrences,
  }));

  const statisticalHypotheses: Array<SkillDriftHypothesis | SubagentDriftHypothesis> = [
    ...skillHypotheses,
    ...subagentHypotheses,
  ];
  const adjustedDriftPValues = holmAdjusted(statisticalHypotheses.map((item) => item.rawPValue));
  statisticalHypotheses.forEach((item, index) => {
    const adjustedPValue = adjustedDriftPValues[index] as number;
    item.pValue = round(item.rawPValue, 6);
    item.adjustedPValue = round(adjustedPValue, 6);
    item.confidence =
      adjustedPValue <= DRIFT_ALPHA + 1e-12 ? "statistically-confirmed" : "inconclusive";
  });
  const skills: SkillDrift[] = skillHypotheses
    .filter((item) => item.changed)
    .map(({ changed: _changed, rawPValue: _rawPValue, ...item }) => item);
  const subagents: SubagentDrift[] = subagentHypotheses
    .filter((item) => item.changed)
    .map(({ changed: _changed, rawPValue: _rawPValue, ...item }) => item);

  const hasUnattributedCalls = [...baseRuns, ...headRuns].some((run) =>
    run.toolCalls.some((call) => call.evalName === undefined),
  );
  const toolScopes: Array<string | null> = [...evalNames, ...(hasUnattributedCalls ? [null] : [])];
  const toolSequences: ToolSequenceDrift[] = toolScopes
    .map((evalName): ToolSequenceDrift => {
      const scopedBase = scopedRuns(baseRuns, evalName);
      const scopedHead = scopedRuns(headRuns, evalName);
      const baseSeq = mostCommonSequence(scopedBase, evalName);
      const headSeq = mostCommonSequence(scopedHead, evalName);
      const diverged = !sequencesEqual(baseSeq.sequence, headSeq.sequence);
      const sequenceConfidence = !diverged
        ? null
        : baseSeq.tied || headSeq.tied || scopedBase.length < 2 || scopedHead.length < 2
          ? "inconclusive"
          : baseSeq.count === scopedBase.length && headSeq.count === scopedHead.length
            ? "stable"
            : "inconclusive";
      const sequenceReason =
        baseSeq.tied || headSeq.tied
          ? "modal sequence is tied within at least one ref"
          : sequenceConfidence === "stable"
            ? "each sequence repeated consistently within its ref"
            : "modal sequences differ, but within-ref variation makes the change inconclusive";
      return {
        evalName,
        baseMostCommon: baseSeq.sequence,
        baseMostCommonRuns: baseSeq.count,
        baseTotalRuns: scopedBase.length,
        headMostCommon: headSeq.sequence,
        headMostCommonRuns: headSeq.count,
        headTotalRuns: scopedHead.length,
        divergenceNote: diverged
          ? `most common tool sequence diverges: base saw it in ${baseSeq.count} of ${scopedBase.length} runs, ` +
            `head saw a different one in ${headSeq.count} of ${scopedHead.length} runs — ${sequenceReason}`
          : null,
        divergenceConfidence: sequenceConfidence,
        callCountDeltas: toolCountDeltas(scopedBase, scopedHead, evalName),
      };
    })
    .filter((sequence) => sequence.divergenceNote !== null || sequence.callCountDeltas.length > 0);

  const toolInputs = toolInputDeltas(baseRuns, headRuns);
  const outputScopes = evalNames.filter((evalName) =>
    [...baseRuns, ...headRuns].some((run) =>
      run.evalResults.some(
        (result) =>
          result.name === evalName &&
          (result.finalOutput !== undefined || result.finalOutputAbsent === true),
      ),
    ),
  );
  const hasOnlyLegacyAggregateOutputs =
    outputScopes.length === 0 &&
    [...baseRuns, ...headRuns].some((run) => run.finalOutput !== undefined);
  const finalOutputs = [
    ...outputScopes.map((evalName) => finalOutputDelta(baseRuns, headRuns, evalName)),
    ...(hasOnlyLegacyAggregateOutputs ? [finalOutputDelta(baseRuns, headRuns, null)] : []),
  ].filter((value): value is FinalOutputDelta => value !== null);

  const hasDrift =
    skills.some((item) => item.confidence === "statistically-confirmed") ||
    subagents.some((item) => item.confidence === "statistically-confirmed") ||
    toolSequences.some(
      (sequence) =>
        sequence.divergenceConfidence === "stable" ||
        sequence.callCountDeltas.some((item) => item.confidence === "stable"),
    ) ||
    toolInputs.some((item) => item.confidence === "stable") ||
    finalOutputs.some((item) => item.confidence === "stable");
  const hasInconclusive =
    skills.some((item) => item.confidence === "inconclusive") ||
    subagents.some((item) => item.confidence === "inconclusive") ||
    toolSequences.some(
      (sequence) =>
        sequence.divergenceConfidence === "inconclusive" ||
        sequence.callCountDeltas.some((item) => item.confidence === "inconclusive"),
    ) ||
    toolInputs.some((item) => item.confidence === "inconclusive") ||
    finalOutputs.some((item) => item.confidence === "inconclusive");

  return { skills, toolSequences, subagents, toolInputs, finalOutputs, hasDrift, hasInconclusive };
}
