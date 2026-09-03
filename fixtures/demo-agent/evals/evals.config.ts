import { defineEvalConfig } from "eve/evals";

// maxConcurrency 1 keeps run ordering deterministic for diff0's tests.
export default defineEvalConfig({ maxConcurrency: 1 });
