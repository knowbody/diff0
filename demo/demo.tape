# demo/demo.tape — the diff0 demo on the REAL model, three beats:
#   1. git diff tells you what changed in the code
#      (simplify-pipeline deletes the two reporter-delegation lines)
#   2. eve eval tells you nothing changed (4/4 green on head)
#   3. diff0 tells you what changed in the agent
#      (YELLOW: reporter used in 5 of 5 base runs -> 0 of 5 head runs,
#       cost/session down ~a third)
#
# Prerequisites: bash demo/setup.sh   (builds diff0, creates /tmp/diff0-demo
# on branch simplify-pipeline, sources AI_GATEWAY_API_KEY from the repo .env,
# warms eve and diff0's base cache so beat 3 runs head-only).
# Record FROM THE REPO ROOT: vhs demo/demo.tape   (the hidden setup below
# resolves the repo .env and dist/cli.js relative to the invocation
# directory). Real-model beats take real time: beat 2 ~25-40s, beat 3 ~2-3m.
#
# SAFETY: the hidden block below sources the gateway key. Everything between
# Hide and Show is never captured in a frame, and the block ends with a
# `clear`, so no frame ever contains the source command or any env value.

Output demo/demo.gif

Require git
Require node
Require pnpm

Set Shell "bash"
Set FontSize 15
Set Width 1040
Set Height 1400
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 24
Set WaitTimeout 240s

# --- hidden setup: gateway key (never shown), diff0 alias, minimal prompt,
# --- no git pager, cwd = demo repo -----------------------------------------
Hide
Type 'set -a; source "$PWD/.env"; set +a; unset DIFF0_DEMO_MODEL'
Enter
Type 'alias diff0="node $PWD/dist/cli.js"'
Enter
Type "export GIT_PAGER=cat"
Enter
Type "export PS1='$ '"
Enter
Type "cd /tmp/diff0-demo && clear"
Enter
Show

# --- beat 1: git diff ------------------------------------------------------
Type "# git diff tells you what changed in the code."
Enter
Sleep 600ms
Type "git diff main -- agent/instructions.md"
Sleep 500ms
Enter
Sleep 6s

Hide
Type "clear"
Enter
Show

# --- beat 2: eve eval — 4/4 pass, green, on the real model ------------------
Type "# eve eval tells you nothing changed."
Enter
Sleep 600ms
Type "pnpm exec eve eval 2>/dev/null"
Sleep 500ms
Enter
Wait+Screen@120s /Results: 4 passed/
Sleep 4s
# eve's local world can linger on teardown; a visible ^C keeps the tape moving.
Ctrl+C
Sleep 800ms

Hide
Type "clear"
Enter
Show

# --- beat 3: diff0 — YELLOW, subagent drift caught --------------------------
Type "# diff0 tells you what changed in the agent."
Enter
Sleep 600ms
Type "diff0 run --base main --head simplify-pipeline --runs 5 --cache"
Sleep 800ms
Enter
Wait+Screen@240s /treat proportions, not absolutes/
# hold on the yellow verdict + reporter subagent drift + cost lines
Sleep 5s
