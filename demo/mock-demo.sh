#!/usr/bin/env bash
# demo/mock-demo.sh: run the diff0 drift demo on eve's deterministic mock.
#
# Zero credentials, zero cost, ~1 minute. Idempotent: safe to re-run; it
# rebuilds the demo repo at /tmp/diff0-mock-demo from scratch every time.
#
# What it shows: a branch that deletes the "You MUST load the
# `revenue-definitions` skill" rule from agent/instructions.md. The mock
# model keys on that exact sentence (see fixtures/demo-agent/agent/agent.ts),
# so the skill stops loading on the head ref while every eval still passes.
# diff0 reports that as a deterministic YELLOW verdict: skill drift,
# 3 of 3 base runs -> 0 of 3 head runs.
#
# DIFF0_DEMO_MODEL=mock forces the mock even on keyed machines; this script
# never reads or sources any .env.
#
# Usage: bash demo/mock-demo.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEMO_REPO=/tmp/diff0-mock-demo
FIXTURE="${REPO_ROOT}/fixtures/demo-agent"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# -------------------------------------------------------- 1. prerequisites
step "Checking prerequisites (node >= 24, pnpm)"
if ! command -v node >/dev/null 2>&1; then
  echo "error: node is not installed (need >= 24)." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt 24 ]; then
  echo "error: node >= 24 required (found $(node -v))." >&2
  exit 1
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "error: pnpm is not installed (corepack enable, or npm i -g pnpm)." >&2
  exit 1
fi
echo "node $(node -v), pnpm $(pnpm -v)"

# --------------------------------------------------------------- 2. diff0
step "Building diff0 (${REPO_ROOT})"
if [ ! -f "${REPO_ROOT}/dist/cli.js" ]; then
  (cd "${REPO_ROOT}" && pnpm install && pnpm build)
else
  echo "dist/cli.js already present, skipping install+build"
  echo "(delete ${REPO_ROOT}/dist to force a rebuild)"
fi

# ------------------------------------------------------ 3. demo repo files
step "Creating demo repo at ${DEMO_REPO}"
rm -rf "${DEMO_REPO}"
mkdir -p "${DEMO_REPO}"
cp -R "${FIXTURE}/." "${DEMO_REPO}/"
rm -rf "${DEMO_REPO}/node_modules" "${DEMO_REPO}/.eve"

cat > "${DEMO_REPO}/.gitignore" <<'EOF'
node_modules/
.eve/
EOF

# ------------------------------------------------- 4. git history (2 refs)
step "Committing baseline on main"
cd "${DEMO_REPO}"
git init -q -b main
git config user.name "Demo Corp"
git config user.email "demo@example.com"
git add -A
git commit -q -m "baseline revenue analyst agent"

step "Creating tighten-instructions branch with the drift edit"
# The drift edit: delete exactly the two-line rule that tells the analyst it
# MUST load the `revenue-definitions` skill. The mock model keys on that
# sentence, so the head ref stops calling load_skill: deterministic drift.
git checkout -q -b tighten-instructions
perl -0pi -e 's/^- You MUST load the `revenue-definitions` skill before answering any revenue\n  question, so your figures use the canonical definitions\.\n//m' \
  agent/instructions.md
if [ "$(git diff --numstat -- agent/instructions.md)" != "$(printf '0\t2\tagent/instructions.md')" ]; then
  echo "error: drift edit did not remove exactly the two skill-load lines" >&2
  echo "       (fixture agent/instructions.md changed? update the perl match in mock-demo.sh)" >&2
  exit 1
fi
git add agent/instructions.md
git commit -q -m "tighten instructions: drop the skill-load rule"

# --------------------------------------------------------- 5. dependencies
step "Installing demo repo dependencies (pnpm install)"
pnpm install --prefer-offline

# ---------------------------------------------------------------- 6. diff0
step "Running diff0 on the deterministic mock (3 runs per ref, \$0.00)"
DIFF0_DEMO_MODEL=mock node "${REPO_ROOT}/dist/cli.js" run \
  --base main --head tighten-instructions \
  --repo "${DEMO_REPO}" --runs 3
