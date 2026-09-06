/** A schema-valid approval alone is insufficient evidence of success. */
export function codingAttemptPassed({ verified, implementation, review, attested }) {
  const result = review.output;
  return (
    verified.passed === true &&
    !implementation.error &&
    !review.error &&
    implementation.output?.pushed === false &&
    result?.verdict === "approve" &&
    result.blocking_findings.length === 0 &&
    result.criteria_results.length > 0 &&
    result.criteria_results.every((criterion) => criterion.pass === true) &&
    attested === true
  );
}
