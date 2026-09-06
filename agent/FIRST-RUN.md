# First connected dogfood run

On 2026-09-05, the opt-in `pipeline/github-tools-regression` assignment ran against the
private disposable repository `knowbody/diff0-eve-sandbox`, seeded from diff0 `474e7f5`.
The audit work item is https://github.com/knowbody/diff0-eve-sandbox/issues/1.

The run started at 17:42:30 UTC and finished at 18:10:03 UTC. Classification and analysis
completed. Implementation failed when AI Gateway reported insufficient credit. The reviewer
was never called and no draft PR was created. This is a failed full-pipeline validation.
It used direct eval dispatch; it did not validate GitHub webhook delivery.

The local trace `901ca128be47b58842933329f40f6c97` records $12.1716858 in model costs across
84 steps with reported cost. Two failed steps have no reported cost. Sum `gen_ai.usage.cost`
on `agent.step` spans once; do not add the parallel gateway/input/output cost fields again.

| Station | Recorded model cost (USD) |
| --- | ---: |
| Orchestrator | 0.1908482 |
| Classifier | 0.0072052 |
| Analyst | 2.1652474 |
| Implementer | 9.8083850 |

These figures exclude sandbox/hosting charges and separate eval or CI runs. They are recorded
request costs, not a reconciled account bill. The full pipeline had a 30-minute timeout but no
hard dollar budget; the CI comparison's $3 measured-cost threshold did not apply to this task.

The implementer repeatedly attempted registry downloads despite the sandbox's offline policy,
then spent substantial time investigating the installed compiler and SDK. Station instructions
were updated for subsequent turns to use installed dependencies and report missing prerequisites.
Eve keeps in-flight runtime generations immutable, so those edits did not repair the active turn.

Further paid attempts were stopped after the user raised cost concerns. Before retrying, use an
explicit user-agreed budget, enforce it across all stations, and stop early on missing prerequisites
or repeated investigation without progress. Do not treat this run as proof of autonomous readiness.

The integration remains draft PR https://github.com/knowbody/diff0/pull/19. Local checks after
incorporating the library API change on `main`: 367 unit tests, six integration tests, the package
consumer test, typecheck, lint, build, and Action bundle consistency passed. The deterministic demo
comparison was green over three runs per ref. The first real maintenance-agent CI comparison
completed yellow with the updated agent passing all four evals on all three runs; its cost was
unavailable in the report. The separate paid demo CI job was cancelled. No production maintenance
agent deployment or merge was performed.
