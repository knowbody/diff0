/**
 * Normalized data model. Every analysis and report consumes RunRecord[] —
 * never raw eve output. The only producer is adapters/eve.ts.
 */

/** Result of a single check/assertion inside one eval. */
export interface CheckResult {
  name: string;
  passed: boolean;
  /** Score in [0,1] when the check is a scorer/judge rather than a boolean assertion. */
  score?: number;
}

/** Result of one named eval within one run. */
export interface EvalResult {
  name: string;
  passed: boolean;
  checks: CheckResult[];
  durationMs?: number;
  /** Privacy-preserving identity of this eval's final response, when captured. */
  finalOutput?: FinalOutputFingerprint;
}

/** One tool invocation observed during a run, in call order. */
export interface ToolCall {
  name: string;
  /** 0-based position in the session's tool-call sequence. */
  order: number;
  /** Stable hash of the tool inputs (never the raw inputs — may contain secrets). */
  inputsHash: string;
  /** Eval name this call was observed under, when attributable. */
  evalName?: string;
}

/** One subagent delegation observed during a run. */
export interface SubagentCall {
  name: string;
  order: number;
  evalName?: string;
}

/** One skill load observed during a run. */
export interface SkillLoad {
  name: string;
  /** Eval name this load was observed under, when attributable. */
  evalName?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  /** Provider-reported prompt-cache reads. Kept separate because pricing differs from input. */
  cacheRead: number;
  /** Provider-reported prompt-cache writes. Kept separate because pricing may be unavailable. */
  cacheWrite: number;
}

/**
 * Dependency lifecycle-script policy for checked-out refs.
 * Neither mode is a sandbox or trust boundary.
 */
export type DependencyInstallMode = "scripts-off" | "scripts-on";

/** Privacy-preserving identity of the agent's final response. Raw output is never retained. */
export interface FinalOutputFingerprint {
  /** Stable hash of the normalized final output. */
  hash: string;
  /** Character length of the normalized final output, when available. */
  length?: number;
}

/** Which local sandbox backend eve actually used for a run. */
export type SandboxBackend = "docker" | "microsandbox" | "just-bash" | "unknown";

/**
 * Everything captured from a single `eve eval` suite execution against one ref.
 * runIndex is 0-based within that ref.
 */
export interface RunRecord {
  ref: string;
  /** Resolved commit SHA for the ref at run time. */
  commitSha: string;
  runIndex: number;
  evalResults: EvalResult[];
  toolCalls: ToolCall[];
  /** Eval-attributed skill loads used by drift analysis. */
  skillLoads: SkillLoad[];
  /** Distinct suite-level names retained for summaries and compatibility. */
  skillsLoaded: string[];
  subagentCalls: SubagentCall[];
  /**
   * @deprecated Aggregate compatibility fingerprint. New analysis uses EvalResult.finalOutput so
   * independent evals cannot be conflated or made order-sensitive.
   */
  finalOutput?: FinalOutputFingerprint;
  tokens: TokenUsage;
  /** null when no cost source (neither provider metadata nor prices.json entry) was available. */
  costUsd: number | null;
  durationMs: number;
  sandboxBackend: SandboxBackend;
  model: string;
  /** Model usable for fallback token pricing; null when usage spans models we cannot separate. */
  pricingModel: string | null;
  eveVersion: string;
  /**
   * Which data sources actually fed this record. The report must state this —
   * honest framing requires never implying data we did not capture.
   */
  dataSources: {
    evalJson: boolean;
    spans: boolean;
    logs: boolean;
  };
  startedAt: string; // ISO 8601
}

/** Options passed through to the adapter for one suite execution. */
export interface RunOptions {
  /** Absolute path to the worktree containing the agent repo at the target ref. */
  cwd: string;
  runIndex: number;
  /** Eval id/prefix filters (eve eval positional args); empty = all. */
  evalFilter: string[];
  timeoutMs?: number;
  /** Passed to `eve eval --max-concurrency`; omitted = eve's own default. */
  maxConcurrency?: number;
  /** Extra environment (user env vars pass through untouched; keys are never logged). */
  env?: Record<string, string>;
  /**
   * Sandbox backend inferred by the harness (see harness/sandbox.ts) and
   * recorded verbatim on the RunRecord. Defaults to "unknown".
   */
  sandboxBackend?: SandboxBackend;
}

/**
 * Structural surface of an agent at one ref, from `eve info --json`.
 * Used for the report's surface diff; null-tolerant on capture failure.
 */
export interface AgentInfo {
  /** Configured model id, e.g. "anthropic/claude-sonnet-5"; null when unresolvable. */
  model: string | null;
  skills: string[];
  tools: string[];
  subagents: string[];
}

/** The single seam between diff0 and eve. Implemented by adapters/eve.ts. */
export interface EveAdapter {
  /** Detect eve, its version, and that the repo has at least one eval suite. */
  probe(cwd: string): Promise<{ eveVersion: string; evalIds: string[] }>;
  /** Run the suite once and return the normalized record. */
  runEvalSuite(ref: string, commitSha: string, opts: RunOptions): Promise<RunRecord>;
}
