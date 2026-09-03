#!/usr/bin/env bash
# demo/setup.sh — prepare everything the vhs demo tape needs. Idempotent:
# safe to re-run; it rebuilds the demo repo at /tmp/diff0-demo from scratch
# and pre-warms diff0's base-ref cache so the recorded run is head-only.
#
# The demo runs against the REAL model (anthropic/claude-haiku-4.5 via the
# AI Gateway): this script sources AI_GATEWAY_API_KEY from the repo's .env
# for the pre-warm, and demo.tape sources it again (hidden) for the
# recording. Pre-warm cost is ~$0.12 (10 suite runs); the recording itself
# adds ~$0.06 (1 eve suite + 5 head runs).
#
# Usage: bash demo/setup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEMO_REPO=/tmp/diff0-demo
FIXTURE="${REPO_ROOT}/fixtures/demo-agent"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# ----------------------------------------------------- 0. gateway credentials
step "Loading gateway credentials from ${REPO_ROOT}/.env"
if [ -f "${REPO_ROOT}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
fi
if [ -z "${AI_GATEWAY_API_KEY:-}" ]; then
  echo "error: AI_GATEWAY_API_KEY is not set (and not found in ${REPO_ROOT}/.env)." >&2
  echo "The demo records real-model runs; add AI_GATEWAY_API_KEY=... to ${REPO_ROOT}/.env." >&2
  exit 1
fi
# Guarantee real-model auto-selection (see fixtures/demo-agent/agent/lib/demo-model.ts):
# a stray DIFF0_DEMO_MODEL=mock would silently record the wrong demo.
unset DIFF0_DEMO_MODEL
echo "AI_GATEWAY_API_KEY is set (value not shown)"

# ---------------------------------------------------------------- 1. diff0
step "Building diff0 (${REPO_ROOT})"
if [ ! -f "${REPO_ROOT}/dist/cli.js" ]; then
  (cd "${REPO_ROOT}" && pnpm install && pnpm build)
else
  echo "dist/cli.js already present — skipping install+build"
  echo "(delete ${REPO_ROOT}/dist to force a rebuild)"
fi

# ------------------------------------------------------ 2. demo repo files
step "Creating demo repo at ${DEMO_REPO}"
rm -rf "${DEMO_REPO}"
mkdir -p "${DEMO_REPO}"
rsync -a --exclude node_modules --exclude .eve "${FIXTURE}/" "${DEMO_REPO}/"

cat > "${DEMO_REPO}/.gitignore" <<'EOF'
node_modules/
.eve/
EOF

# ------------------------------------------------- 3. git history (2 refs)
step "Committing baseline on main"
cd "${DEMO_REPO}"
git init -q -b main
git config user.name "Demo Corp"
git config user.email "demo@example.com"
git add -A
git commit -q -m "baseline revenue analyst agent"

step "Creating simplify-pipeline branch with the drift edit"
# The drift edit: delete exactly the two instruction lines that tell the
# analyst to delegate a one-line executive summary to the `reporter`
# subagent. Every eval still passes on this branch — but the reporter
# subagent stops being used (5/5 base runs -> 0/5 head runs on
# anthropic/claude-haiku-4.5). That is the behavioral drift diff0 catches.
git checkout -q -b simplify-pipeline
perl -0pi -e 's/^- After computing a figure, delegate a one-line executive summary to the\n  `reporter` subagent before replying\.\n//m' \
  agent/instructions.md
if [ "$(git diff --numstat -- agent/instructions.md)" != "$(printf '0\t2\tagent/instructions.md')" ]; then
  echo "error: drift edit did not remove exactly the two reporter-delegation lines" >&2
  echo "       (fixture agent/instructions.md changed? update the perl match in setup.sh)" >&2
  exit 1
fi
git add agent/instructions.md
git commit -q -m "simplify pipeline: drop the reporter hand-off"
echo "on branch: $(git branch --show-current) (beat 2 runs eve eval here)"

# --------------------------------------------------------- 4. dependencies
step "Installing demo repo dependencies (pnpm install)"
(cd "${DEMO_REPO}" && pnpm install --prefer-offline)

# --------------------------------------------------- 5. pre-warm the cache
step "Warming eve (throwaway real-model eval run on head, ~\$0.01)"
# The very first eve suite run on a cold machine pays a one-time compile/
# warm-up cost. Pay it here so (a) the pre-warmed base-run durations look
# like steady-state runs, and (b) beat 2's on-camera `eve eval` is honest
# steady-state timing rather than a cold-compile outlier.
(cd "${DEMO_REPO}" && pnpm exec eve eval) || true

step "Pre-warming diff0 base cache (5 runs per ref, real model, ~\$0.12)"
# This writes ${DEMO_REPO}/.git/diff0-cache/<key>.json for the main ref, so the
# recorded beat-3 run hits the base cache and only executes 5 head runs —
# keeps the GIF short while the recording still shows genuine head runs.
node "${REPO_ROOT}/dist/cli.js" run \
  --base main --head simplify-pipeline \
  --repo "${DEMO_REPO}" --runs 5 --cache --no-color

step "Done"
echo "Demo repo ready at ${DEMO_REPO} (on simplify-pipeline, base cache warm)."
echo "Record with: cd ${REPO_ROOT} && vhs demo/demo.tape"
