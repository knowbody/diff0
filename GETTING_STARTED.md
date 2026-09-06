# Getting started with diff0

Add a small eval suite to your Eve project, save a baseline, and compare your next
agent change. You can run diff0 with `npx`; no global installation is needed.

Already have working evals on both Git refs? Skip to [Run a comparison](#3-run-a-comparison).

## 1. Start with a working Eve app

You need macOS or Linux, Git, Node.js 24 or newer for current Eve releases, and
your project's package manager. diff0 works with npm, pnpm, Yarn, and Bun lockfiles.
Commit the lockfile: diff0 installs each ref's dependencies in a separate temporary
worktree using a frozen install.

Run commands from the **app root**, the directory containing `agent/` and `evals/`:

```text
my-project/
├── package.json
├── pnpm-lock.yaml
├── agent/
│   ├── agent.ts
│   └── instructions.md
└── evals/                 # add this in the next step
```

The examples use pnpm for your app's Eve commands. Use the equivalent command
from your project's package manager if it uses something else.

Install your app's dependencies before running its evals:

```sh
pnpm install --frozen-lockfile
```

Make your usual model credentials available in the shell that runs diff0. For
Vercel AI Gateway, load `AI_GATEWAY_API_KEY` using your secret manager or replace
the placeholder below with your key:

```sh
export AI_GATEWAY_API_KEY="YOUR_AI_GATEWAY_KEY"
```

An ignored `.env` file in your checkout is **not copied into the temporary
worktrees**. Keep credentials out of committed files.

Your evals also need any services or sandbox setup they normally use. For a first
test, choose a question that does not need production connectors or write to an
external system. diff0 executes the actual agent from both refs; it does not mock
its tools or supply a sandbox configuration.

## 2. Add one useful eval and save the baseline

Skip creating these files if your app already has an eval suite. Otherwise, create
`evals/evals.config.ts`:

```ts
import { defineEvalConfig } from "eve/evals";

export default defineEvalConfig({ maxConcurrency: 1 });
```

Then create `evals/identity.eval.ts`:

```ts
import { defineEval } from "eve/evals";

export default defineEval({
  description: "Identifies the project this agent helps maintain.",
  async test(t) {
    await t.send("What project do you help maintain? Answer in one sentence.");
    t.succeeded();
    t.messageIncludes("YOUR_PROJECT_NAME");
  },
});
```

Replace `YOUR_PROJECT_NAME` with a name your agent is already instructed to use.
For a different kind of agent, replace the question and assertion with one small
task it should reliably complete. `t.succeeded()` checks execution; the second
assertion checks something about the answer. Neither assertion uses a judge model,
but the agent's response still uses your configured model.

Check the eval directly before adding diff0:

```sh
pnpm exec eve eval identity
```

If it fails, inspect Eve's output and fix the setup or assertion first. When it
passes, commit the suite and any required setup, then mark that commit as your
baseline:

```sh
git add evals/
# Also stage any agent/config/dependency files you changed for local evals.
git commit -m "test: add agent identity eval"
git branch diff0-baseline
```

**Keep the same evals on both refs.** Adding or changing the evaluator only on the
head ref makes the comparison confounded: diff0 warns and caps the verdict at
yellow. The `diff0-baseline` branch lets you try this locally before the eval suite
has landed on `main`.

## 3. Run a comparison

Make an agent change, such as editing `agent/instructions.md`, and commit it:

```sh
git add agent/instructions.md
git commit -m "Improve agent instructions"
```

Estimate first, then run three repetitions per ref:

```sh
npx @knowbody/diff0 estimate --base diff0-baseline --evals identity --runs 3 --max-spend 1
npx @knowbody/diff0 run --base diff0-baseline --evals identity --runs 3 --max-spend 1
```

If your evals are already on `main`, use `--base main` instead. Replace `identity`
with an existing eval ID, or omit `--evals` to run the whole suite. In a monorepo,
run from the Git repository root and add `--app-dir apps/my-app` to both commands.
That path must contain the app's `agent/` and `evals/` directories; it is **not**
the `agent/` directory itself.

The head defaults to committed `HEAD`. Keep your checkout clean: diff0 rejects a
dirty `HEAD` so it cannot silently leave your edits out of the comparison.

The estimate makes real model calls and is charged separately from the comparison.
`--max-spend` is checked after each suite run and can overshoot by one run. If cost
is unavailable, diff0 cannot enforce that limit. See [cost controls](README.md#cost-controls).

To save a report, add output paths to the `run` command:

```sh
npx @knowbody/diff0 run --base diff0-baseline --evals identity --runs 3 --max-spend 1 \
  --report-md /tmp/diff0-report.md --report-json /tmp/diff0-report.json
```

## 4. Read the result

| Result | Meaning | Default exit code |
| --- | --- | --- |
| Green | No regression or review-worthy drift detected | `0` |
| Yellow | Drift, flakiness, incomplete evidence, or a confounded comparison needs review | `0` |
| Red | An eval regression crossed the release gate | `1` |

Start with eval pass counts, then inspect tool/skill changes and cost. Three runs
per side are a useful first check; they do not prove two agents behave identically.
The [CLI contract](https://github.com/knowbody/diff0/blob/main/docs/cli-contract.md)
explains the statistical and operational regression rules, other exit codes, and
how `--fail-on` changes the gate.

For a quick control, compare the baseline to itself with
`--base diff0-baseline --head diff0-baseline`. This still makes model calls and can
show variation. To check that your eval catches a failure, make a temporary local
commit that deliberately violates its assertion, then compare it to the same
baseline without changing the eval.

## If setup gets in the way

| Symptom | What to check |
| --- | --- |
| No evals found | Put `*.eval.ts` files under the app-root `evals/`, alongside `agent/`. Check both refs and `--app-dir`. |
| Missing model credentials | Export credentials into the calling shell. An ignored local `.env` does not travel with the Git refs. |
| Missing generated files, such as `.nuxt/tsconfig.app.json` | The default `scripts-off` install skips lifecycle scripts. If both refs are trusted and need preparation, use `--install-mode scripts-on` on both `estimate` and `run`. |
| Dependency install failed | Check that the committed lockfile matches `package.json`. Reproduce the printed install command in a disposable checkout to see package-manager diagnostics. With pnpm, inspect its build-approval policy too; `scripts-on` does not override it. |
| Agent needs a hosted sandbox or connector | Supply the normal runtime setup, or add an explicit local eval mode to your app. Commit the same setup on both refs before comparing agent changes. |
| Yellow validity warning after adding evals | Save the evaluator/setup changes in the baseline too, then compare a separate agent-only change. |

We exercised this path locally with the external `benjamincanac/whichcodingtools`
agent on Eve 0.44.3 and real Sonnet 5 responses through AI Gateway. After adding
evals and local sandbox setup, the unchanged control passed all 12 eval
observations; an intentional identity prompt regression fell from 3/3 to 0/3 and
produced a red verdict with exit code 1. That checks the local comparison path,
not the project's production GitHub/browser workflow. diff0's automated
end-to-end suite targets Eve 0.47.5; other versions need their own validation.

## Next: put the report on a pull request

Once the local comparison works, follow [Add it to a pull request](README.md#add-it-to-a-pull-request)
for the GitHub Actions workflow. The [Action guide](action/README.md) covers model
credentials, trusted PRs, monorepos, and required checks. Commit the eval baseline
before expecting the first PR comparison to work.
