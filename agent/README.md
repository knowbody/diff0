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
pull-request comparisons. The repository's separate demo fixture has no external write tools and
is used by the narrowly owner-gated real-model dogfood workflow described in the root README.

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
