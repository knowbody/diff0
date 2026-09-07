# diff0 Eve agent

This Eve app maintains `knowbody/diff0`. It is adapted from the official
[Eve Software Factory](https://eve.dev/templates/eve-software-factory-template): a GitHub work
item passes through classifier, analyst, implementer, and independent reviewer stations before
the app opens a reviewed draft pull request.

The agent lives in this repository so its prompts, policies, tests, and evals are reviewed with
the CLI. See [UPSTREAM.md](UPSTREAM.md) for provenance.

## Luna implementation trial

Only the implementer uses `openai/gpt-5.6-luna` with explicit `xhigh` reasoning.
The analyst and researcher retain `openai/gpt-5.4-mini` with provider-default
reasoning. The orchestrator and classifier retain their existing Luna settings. The reviewer remains `openai/gpt-5.6-terra`, and the eval judge remains
`google/gemini-3.6-flash`. All use standard processing; no Fast/priority tier is requested.
Model assignments and the trial reasoning setting live in `agent/lib/models.ts`.

This trial relaxes provider diversity: the implementer and reviewer now both use
OpenAI, while retaining separate models, instructions, tools, and session contexts.
Existing retry limits and approval boundaries remain in force. There is no automatic
fallback to Sonnet when Luna fails.

The [September 6 model pilot](../docs/luna-station-trial.md) used the real gateway,
authored station prompts and schemas, and controlled local tool substitutes. Luna
passed planning and README-edit checks; research needed a follow-up after an invalid
structured response. This is an experiment, not a production quality claim. The initial results led us to
restore Mini for analysis and research and focus the next trial on implementation.
See the [coding trial](../docs/luna-coding-trial.md) for executable scratch-project checks.

During this controlled rollout, compare against commit `c69f6b1` on the same work items in
a disposable `FACTORY_REPO`, using the opt-in pipeline evals below. Compare acceptance
criteria, verified tests, reviewer findings, retries, elapsed time, and total gateway
charges including subagents and judges. Keep evaluator settings fixed. The four
connector-free maintenance evals do not exercise the changed implementation station and
cannot establish its quality. Do not treat unavailable diff0 cost as zero.

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
| Mark ready | Denied unattended; attended sessions require explicit human approval |
| Merge | Unavailable; a person merges the pull request |

The root orchestrator has no shell, file-write, or web-fetch tool. Station sandboxes deny general
network egress after bootstrap. A GitHub installation token never enters a model-controlled
sandbox or process.

## Local validation

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm agent:validate
pnpm agent:test:runtime
pnpm agent:eval --list --json
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
[`eve-diff.yml`](../.github/workflows/eve-diff.yml) compares the actual authored agent on four
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

PRs changing the demo agent's runtime, prompts, skills, evals, or dependency/configuration files
automatically run **diff0 deterministic**, including Eve's drafts. It compares the PR base and
head using the demo fixture's mock model. Open the check's Actions run to read its summary or
download the Markdown/JSON reports. Maintenance-agent changes use their own paid workflow under
the existing owner/approval rules; unrelated documentation, website, CLI, and reporting changes
use ordinary CI. Each comparison also runs when its own workflow changes, to validate its setup.
The deterministic comparison incurs no model charges and does not test the maintenance agent's
real-model behavior. See
[deterministic CI](../docs/credential-free-ci.md).

To run ordinary CI without model charges, apply `skip-paid-evals` to the pull request before
pushing a new commit. Both automatic paid comparison jobs skip while that label is present;
required `ci` and `website` checks still run. Avoid `[skip ci]`, which suppresses those required
checks too. Removing the label takes effect on the next push or newly triggered PR run; it does
not start a comparison by itself or change an already running job. The explicit manual workflow
below remains a separate way to request a paid comparison.

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

The subsequent budgeted `pipeline/tiny-cost` assignment delivered a draft PR for about $0.80
in model charges. See [the run record](SMALL-TASK-RUN.md) for stage costs, evidence, and the
offline validation and retry limitations it exposed, plus the follow-up that closed those gaps.

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

## Runtime verification

Station failures have a durable one-retry limit. After a station fails twice consecutively,
Eve stops before delegating a third attempt. Successful station results reset that counter;
a valid reviewer request for changes can still enter the revision loop. Run the mocked runtime
regression with `pnpm agent:test:runtime`; it makes no model calls to a provider.

The reviewer calls `check_review` sequentially after judging the diff. Each call runs one
required check with a 240-second deadline and durably records the result against the clean
branch, head SHA, and base SHA. This keeps each check below Vercel Hobby's 300-second function
limit. `attest_review` requires every recorded check and verifies the clean commit again;
missing, failed, timed-out, or stale evidence cannot receive an attestation. Engine and Action changes additionally require a consistent Action bundle
and a green deterministic demo comparison. Unchecked prerequisites cannot receive an attestation.

The station bootstrap caches Corepack and pnpm outside HOME, installs both locked dependency
graphs using the setup command in `.env.example`, then proves a fresh isolated-home demo install
works with network access denied. Keep that setup command in production too; installing only
the root dependencies is insufficient for these offline checks.

## Deployment

Before deploying a fork:

1. Create a Vercel project with Sandbox access, Node 24, and the repository root as
   its Root Directory. Run `pnpm exec eve link` from the repository root before deploying.
2. Create a Vercel Connect GitHub connector, install its GitHub App on `FACTORY_REPO`, and grant
   read/write access to contents, issues, and pull requests plus metadata read access.
3. Set `GITHUB_CONNECTOR`, `FACTORY_REPO`, `FACTORY_LABEL`, `FACTORY_BRANCH_PREFIX`, and
   `FACTORY_SETUP_COMMAND` and `FACTORY_BOOTSTRAP_REVISION` from `.env.example`.
4. Provision a private Vercel Blob store and make its token available to the deployment.
5. Enable AI Gateway access for every model configured in the root agent and stations.
6. Create the intake label named by `FACTORY_LABEL`; protect the default branch and require review.
7. Subscribe the GitHub trigger to `issues`, `issue_comment`, and
   `pull_request_review_comment` events, with the project trigger destination set to
   `/eve/v1/github`. Read back the connector configuration to verify the destination.
8. Check Sandbox storage headroom and remove obsolete trial templates; stopping persistent
   sandboxes saves compute but retains snapshots. Hobby currently includes 15 GB of snapshot
   storage ([quotas](https://vercel.com/docs/sandbox/pricing)).
9. Validate read-only behavior against a scratch repository before enabling unattended intake.

Follow Eve's online [GitHub channel](https://eve.dev/docs/channels/github),
[Vercel deployment](https://eve.dev/docs/guides/deployment/vercel), and
[sandbox](https://eve.dev/docs/sandbox) guides, checking APIs against the pinned package.
The online docs can include features that are newer than Eve 0.52.2.

Keep `.vercelignore` in place: Vercel CLI uploads do not inherit `.gitignore`, and `.eve/`
contains local credentials and traces. Local eval backend factories must only execute when
that backend is selected; hosted bundles prune local implementations.

Stage production builds without moving the public alias, then verify the built runtime before
promotion from the linked repository root (substitute the actual linked team and deployment URL):

```sh
vercel deploy --prod --skip-domain --yes --scope YOUR_TEAM
vercel curl /eve/v1/health --deployment DEPLOYMENT_URL -- --fail --silent --show-error
vercel promote DEPLOYMENT_URL --yes --scope YOUR_TEAM
```

Verify `/eve/v1/health` again on the public alias. Health alone does not prove GitHub delivery:
confirm a real webhook reaches `/eve/v1/github` with HTTP 200, then apply `eve-build` once to
a bounded issue and observe the station results, reviewer checks, and draft PR. For CLI-deployed
builds, use `vercel logs DEPLOYMENT_URL --no-branch` so the local Git branch does not hide logs.

Set spend and concurrency limits appropriate to the selected models. Intake is at-most-once while
the label remains present: if a delivery fails after it claims the issue, inspect the Eve delivery
logs, remove the intake label, then apply it again to retry.

## Runtime and packaging

The authored agent lives in `agent/` and its evals in the root `evals/` directory.
Eve 0.52.2 runs from the repository root on Node 24. Keep local environment variables
in the root `.env.local`; Vercel also builds from the repository root.

The CLI and the maintenance agent share the repository manifest. Eve is a local runtime
dependency for discovery and deployment. `pnpm pack` and `pnpm publish` exclude it from
the CLI tarball through the supported hook in `.pnpmfile.cjs`; use the pinned pnpm version.
There is no separate agent package or workspace.

Stations run through the blocking `run_station` workflow so failures settle before
the orchestrator continues. Built-in tools are explicitly enabled per station; only
the researcher receives web tools. Review checks use GitHub-authenticated immutable
base/head metadata, independent of writable sandbox markers. Dependency caches are
reconciled offline after each checkout; bump `FACTORY_BOOTSTRAP_REVISION` and rebuild
the snapshot when the locked dependencies are missing. Brain updates require the
version returned by `read_factory_brain`; conflicts must be reread and merged.
