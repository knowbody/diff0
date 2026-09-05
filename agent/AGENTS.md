# diff0 Eve factory guidance

This repository is an Eve 0.47.5 app that maintains `knowbody/diff0`; its authored runtime lives in
this directory and its evals live in `../evals/`. Read the relevant official guide at
https://eve.dev/docs and compare it with `node_modules/eve/docs/` before changing framework code
or deployment configuration. Online docs can describe a newer runtime than our pinned version;
verify API compatibility in the installed package. Do not infer Eve APIs from an older template.

## Required validation

Run from the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm agent:validate
pnpm agent:test:runtime
pnpm exec eve eval --list --json
```

`pnpm agent:validate` must finish with zero formatting, type, test, and Eve discovery diagnostics. Real-model
evals cost money. The `pipeline` evals can modify `FACTORY_REPO` and are opt-in only.

## Architecture and safety

- `agent/instructions.ts` owns orchestration. Work moves through classifier, analyst, implementer,
  and independent reviewer stations.
- Filesystem paths define tool, skill, channel, extension, and subagent identities.
- Model assignments live only in `agent/lib/models.ts`. Keep implementer and reviewer on different
  provider families.
- `agent/lib/trust.ts` is the single trust authority. Repository writes use policies from
  `agent/lib/github/approval.ts`.
- Task-mode subagents cannot wait for approval. Keep approvable tools on the root agent and make
  station side effects inert by construction.
- Sandbox Git credentials are scoped to exact upload-pack reads. Branch publication runs in trusted
  app code through the GitHub API, validates the immutable base and changed files, and binds the
  branch to the root session.
- Eve may publish session-owned `eve/*` branches and open draft pull requests. It may not merge.
  Marking ready is a human decision.
- Engine or Action changes require the ordinary diff0 checks plus the deterministic
  `fixtures/demo-agent` behavioral comparison described in the implementer and reviewer prompts.

See [README.md](README.md) for operation and [UPSTREAM.md](UPSTREAM.md) for template provenance.
