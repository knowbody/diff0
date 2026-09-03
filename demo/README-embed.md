# Embedding the demo GIF in the README

## Snippet

```markdown
![Recorded diff0 CLI demo showing a real-model behavioral comparison after two reporter-delegation instruction lines are deleted](https://raw.githubusercontent.com/knowbody/diff0/main/demo/demo.gif)
```

(Absolute URL so the image renders on the npm package page too.)

Optionally add a caption line under it:

```markdown
*git diff tells you what changed in the code. eve eval says nothing changed. diff0 tells you what changed in the agent.*
```

## Current artifact

`demo/demo.gif` — 556,574 bytes (543 KB), 121.2 s, 3030 frames @ 24 fps, 1040×1400 px
(~100 cols). This is a historical real-model capture from 2026-08-03
(`anthropic/claude-haiku-4.5`, Eve 0.29.5, N=5). The current public source of truth is
[showcase PR #8](https://github.com/knowbody/diff0/pull/8), which ran the same model with Eve 0.47.5
and N=10 in GitHub Actions. The animation's three beats are:

1. `# git diff tells you what changed in the code.` → `git diff main -- agent/instructions.md`
   shows exactly the two removed reporter-delegation lines.
2. `# eve eval tells you nothing changed.` → `pnpm exec eve eval 2>/dev/null` → 4/4 green.
3. `# diff0 tells you what changed in the agent.` →
   `diff0 run --base main --head simplify-pipeline --runs 5 --cache` → base-cache hit + 5 live head
   runs → 🟡 YELLOW; `reporter: used in 5 of 5 base runs -> 0 of 5 head runs`; cost/session,
   tokens, and duration all down roughly a quarter to a third (exact percentages vary run to
   run — that's the nondeterminism the tool exists for; the committed
   [examples/drift-report.md](../examples/drift-report.md) is its own N=5 run of the same story).

## Regenerating

From the **repo root** (the tape resolves `.env` and `dist/cli.js` relative to the invocation
directory), with `AI_GATEWAY_API_KEY` in the repo `.env`:

```bash
bash demo/setup.sh && vhs demo/demo.tape
```

`setup.sh` is idempotent: it builds diff0 if `dist/` is missing, recreates the demo repo at
`/tmp/diff0-demo` (branches `main` + `simplify-pipeline`, checked out on `simplify-pipeline`
for beat 2), installs its dependencies, warms eve's compile cache, and pre-warms diff0's
base-ref cache with 5 real base runs so the recorded beat 3 hits the cache and only executes
the five head runs. Real-model beats take real time (~$0.20 of gateway spend for a full
setup+record cycle; re-records reuse the base cache and cost ~$0.06).

Safety: the tape sources the gateway key inside a `Hide` block that ends with `clear` — no
frame ever contains the source command or any env value. After re-rendering, spot-check
extracted frames anyway (`ffmpeg -i demo/demo.gif -vf "select='not(mod(n,150))'" -fps_mode
passthrough /tmp/frames/f%03d.png`).
