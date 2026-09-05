/** Pure comparison API: importing this entrypoint does not load the execution harness. */
export {
  type ComputeDeltaOptions,
  computeDelta,
  DEFAULT_PERFORMANCE_THRESHOLDS,
  ENFORCEMENT_CATEGORIES,
  violatesEnforcement,
} from "./analyze/delta.js";
export type * from "./analyze/types.js";
export type * from "./types.js";
