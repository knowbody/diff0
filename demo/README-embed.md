# Embedding the demo GIF in the README

## Snippet

```markdown
![Current diff0 CLI demo showing a real-model behavioral comparison after delegated reporting is replaced with a direct summary](https://raw.githubusercontent.com/knowbody/diff0/main/demo/demo.gif)
```

(Absolute URL so the image renders on the npm package page too.)

Optionally add a caption line under it:

```markdown
*git diff tells you what changed in the code. eve eval says nothing changed. diff0 tells you what changed in the agent.*
```

## Current artifact

`demo/demo.gif` — 775,511 bytes (757 KB), 148.6 s, 3,715 frames, 1040×1400 px. It is the current
five-run real-model terminal capture, recorded with diff0 v0.1.3, Eve 0.47.5, and
`anthropic/claude-haiku-4.5`. The corresponding 10-run GitHub Actions comparison is
[showcase PR #15](https://github.com/knowbody/diff0/pull/15).
The animation's three beats are:

1. `# git diff tells you what changed in the code.` → `git diff main -- agent/instructions.md`
   shows delegated reporting replaced by the same direct-summary requirement.
2. `# eve eval tells you nothing changed.` → `pnpm exec eve eval 2>/dev/null` → 3/3 green.
3. `# diff0 tells you what changed in the agent.` →
   `diff0 run --base main --head simplify-pipeline --runs 5 --cache` → base-cache hit + 5 live head
   runs → 🟡 YELLOW; `reporter: used in 5 of 5 base runs -> 0 of 5 head runs`, with the eval
   contract still green. Token and duration measurements vary between recordings because the
   model and provider are nondeterministic.

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
