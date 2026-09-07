import type { DeltaReport, EnforcementCategory } from "./types.js";

export { ENFORCEMENT_CATEGORIES } from "./constants.js";

/** True when a report violates any selected granular policy category. */
export function violatesEnforcement(
  report: Pick<DeltaReport, "enforcement">,
  categories: readonly EnforcementCategory[],
): boolean {
  const selected = new Set(categories);
  return report.enforcement.violations.some((violation) => selected.has(violation.category));
}
