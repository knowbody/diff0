# Keeping the showcase current

[PR #15](https://github.com/knowbody/diff0/pull/15) is a permanent draft demo, not a
change to merge. Its only patch replaces reporter delegation with a direct
executive summary while preserving the SQL and answer requirements.

After relevant changes land on `main`, [the refresh workflow](../.github/workflows/showcase.yml)
rebuilds `showcase/live-proof-v3` from current `main` with that same patch, compares
the two exact commits, and updates the existing diff0 comment. It can also be run
manually from Actions. It becomes active when the workflow is merged into `main`.

The workflow refuses unexpected edits on the showcase branch, uses a guarded
force push, and verifies that both PR refs still match before publishing results.
Runs are serialized. A pending notice replaces stale results before evaluation;
each completed comparison uploads JSON and Markdown artifacts. The PR stays draft.

Each refresh runs ten suites per ref using Haiku 4.5 and the existing $0.30 measured
cost threshold. This threshold is checked between suite runs; unavailable cost
cannot be enforced. Only the model credential is exposed to the comparison step.
The workflow runs the comparison itself because GitHub does not trigger another
PR workflow for a push made with `GITHUB_TOKEN`.

The website's `website/content/showcase.json` is a dated, reviewed snapshot, not a
live feed. Its September 4 evidence comes from
[this archived run](https://github.com/knowbody/diff0/actions/runs/33861384290).
Refresh that snapshot separately after reviewing a new report; new measurements
must not inherit the old report's claims about passing evals or behavioral drift.

Ordinary ready PRs retain their paid demo and maintenance comparisons. Draft PRs
and the explicit `skip-paid-evals` label defer those runs; deterministic CI still
runs. The permanent showcase has its own trusted workflow so it can remain draft.
