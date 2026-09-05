# diff0 Eve agent

This Eve app maintains `knowbody/diff0`. It is adapted from the official
[Eve Software Factory](https://eve.dev/templates/eve-software-factory-template): a GitHub work
item passes through classifier, analyst, implementer, and independent reviewer stations before
the app opens a reviewed draft pull request.

The agent lives in this repository so its prompts, policies, tests, and evals are reviewed with
the CLI. See [UPSTREAM.md](UPSTREAM.md) for provenance.

## Boundaries

| Capability | Boundary |
| --- | --- |
| Start an attended session | GitHub verifies `write`, `maintain`, or `admin` repository permission |
| Start unattended work | A user with at least `triage` permission applies `eve-build` |
| Read code | Only `FACTORY_REPO`; sandbox Git auth permits exact read-only upload-pack requests |
| Change code | Validated committed bytes are published to a branch bound to the root session |
| Update issues unattended | Only the stamped intake issue, and only labels/state fields or comments |
| Open pull requests | Draft only, from the exact reviewed commit to the live default branch |
| Persist repository notes | Authenticated private Blob storage; unattended runs cannot write it |
| Merge or mark ready | Never; both remain human decisions |

The root orchestrator has no shell, file-write, or web-fetch tool. Station sandboxes deny general
network egress after bootstrap. A GitHub installation token never enters a model-controlled
sandbox or process.

## Local validation

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm agent:validate
pnpm exec eve eval --list --json
```

Deterministic evals can run without a GitHub connector. Evals tagged `needs-connect` inspect live
repository state and require a configured connector and a seeded scratch repository. Evals tagged
`mutating` also require all of the following, and hard-refuse `knowbody/diff0`:

```sh
export FACTORY_REPO=your-org/disposable-agent-repo
export MUTATING_EVAL_REPO=$FACTORY_REPO
export ALLOW_MUTATING_EVALS=1
pnpm agent:eval --tag mutating
```

Do not include this maintenance agent's mutating or connector-backed evals in automatic
pull-request comparisons. The owner-gated `maintenance-agent` job in
[`diff0.yml`](../.github/workflows/diff0.yml) compares the actual authored agent on four
connector-free evals: `smoke`, `routing/needs-clarification`, `safety/prompt-injection`, and
`safety/write-requires-approval`.
It exercises the root orchestrator, classifier delegation, refusal to follow hostile quoted
instructions, and a GitHub tool call parked at approval before execution. It uses the production model assignments, with no mocked model or replacement agent.
Only the model credential is supplied; GitHub Connect and Blob credentials are absent.
`FACTORY_EVAL_SANDBOX=justbash` keeps the root's seeded skill-file reads in Eve's local interpreter,
so these comparisons do not require Vercel Sandbox credentials or consume hosted VM slots.
In this mode repository stations are unavailable and do not prewarm or clone repositories;
calling one fails explicitly. The production factory and connected station runs still use Vercel.
Full implementation, publication, and review still need the opt-in scratch-repository pipeline eval.

Run the same comparison locally against committed refs:

```sh
pnpm agent:diff --base main --head HEAD
```

Both refs must contain the selected evals. Uncommitted edits are not compared. This command runs
paid models three times per ref. The $3 measured-cost threshold can overshoot by one suite run,
and cannot be enforced when delegated usage has no attributable cost; the CI job also has a
30-minute timeout. The demo fixture retains its own independent PR report.

## Hand work to Eve

Create the configured intake label once (`eve-build` by default). To start work, a maintainer
applies it to an issue with a concrete problem, expected behavior, and acceptance criteria.
Eve classifies the issue, plans and implements a change, has a separate station review it,
then opens a draft PR linked from the issue. Answer clarification questions on the issue and
reapply the label to retry. Mention the installed GitHub App's handle for attended follow-ups.

Automatic paid comparisons accept only owner-authored, owner-triggered branches. For an
Eve-authored PR, review the code and dispatch **Compare reviewed Eve PR** from the default branch,
supplying the PR number and full head SHA. The workflow verifies that exact commit still heads an
open same-repository PR before supplying model credentials. It rechecks the base and head before
posting a separate sticky report. A moved commit requires a new review and dispatch.

```sh
gh workflow run eve-reviewed-diff.yml --ref main -f pr=123 -f reviewed_sha=FULL_REVIEWED_HEAD_SHA
```

The owner must initiate both dispatches and reruns. The workflow must first be merged onto the
default branch. This explicit reviewed-commit path does not grant credentials to arbitrary bot
or fork code.

## First end-to-end assignment

The private `knowbody/diff0-eve-sandbox` repository is a disposable copy of diff0 at `474e7f5`.
Its first assignment reproduces the missing GitHub-tool registration bug, adds deterministic
coverage, and requires the full station pipeline to deliver a reviewed draft PR:

```sh
FACTORY_REPO=knowbody/diff0-eve-sandbox \
MUTATING_EVAL_REPO=knowbody/diff0-eve-sandbox \
ALLOW_MUTATING_EVALS=1 \
pnpm agent:eval pipeline/github-tools-regression --max-concurrency 1
```

Use connected Vercel credentials and unset `FACTORY_EVAL_SANDBOX` for this run. It creates real
branches and draft PRs in the scratch repository and may incur model and sandbox costs. The
eval requires a completed draft-PR tool call, not merely a claimed branch or deliverable. This
tests a direct task session; GitHub webhook delivery is a separate deployment check.

Eve stores completed eval results under `.eve/evals/` and local traces under `.eve/traces/`.
Use `pnpm exec eve traces ls` to find a run and `pnpm exec eve traces <trace-id>` for its station
activity, model usage, and errors. Published draft PRs and their review evidence remain in GitHub.

## Deployment

Before deploying a fork:

1. Create a Vercel project with Sandbox access and deploy from the repository root.
2. Create a Vercel Connect GitHub connector, install its GitHub App on `FACTORY_REPO`, and grant
   read/write access to contents, issues, and pull requests plus metadata read access.
3. Set `GITHUB_CONNECTOR`, `FACTORY_REPO`, `FACTORY_LABEL`, `FACTORY_BRANCH_PREFIX`, and
   `FACTORY_SETUP_COMMAND` from `.env.example`.
4. Provision a private Vercel Blob store and make its token available to the deployment.
5. Enable AI Gateway access for every model configured in the root agent and stations.
6. Create the intake label named by `FACTORY_LABEL`; protect the default branch and require review.
7. Subscribe the GitHub trigger to `issues`, `issue_comment`, and
   `pull_request_review_comment` events.
8. Validate read-only behavior against a scratch repository before enabling unattended intake.

Set spend and concurrency limits appropriate to the selected models. Intake is at-most-once while
the label remains present: if a delivery fails after it claims the issue, inspect the Eve delivery
logs, remove the intake label, then apply it again to retry.
