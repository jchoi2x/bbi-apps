#!/usr/bin/env bash
# Cloud Agent install: idempotent repository bootstrap for the bbi-apps monorepo.
# Runs after the repo is checked out. System tools (bun, uv, docker, php,
# terraform, node, python) are baked into the base snapshot; this script only
# refreshes source-derived state (submodules + per-project dependencies).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export PATH="$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

echo "== Resolve git submodules =="
# Remove any stale *untokenized* github rewrite that could shadow the Cloud
# Agent's built-in tokenized credential (a plain rewrite makes clones prompt
# for a username and fail non-interactively).
git config --global --unset-all url."https://github.com/".insteadOf 2>/dev/null || true
# .gitmodules pins git@github.com: SSH URLs, but the Cloud Agent authenticates
# to GitHub over HTTPS with a scoped token. Reuse the credential already
# embedded in the origin remote (or gh's token) to rewrite GitHub URLs to
# authenticated HTTPS. Passed via `git -c` so the token is NOT persisted into
# git config or the environment snapshot.
auth_args=()
origin_url="$(git config --get remote.origin.url || true)"
cred=""
if [[ "$origin_url" =~ ^https://([^/@]+)@github.com/ ]]; then
  cred="${BASH_REMATCH[1]}"
  echo "   using credential embedded in origin remote"
elif command -v gh >/dev/null 2>&1 && tok="$(gh auth token 2>/dev/null)" && [ -n "$tok" ]; then
  cred="x-access-token:${tok}"
  echo "   using gh auth token"
fi
if [ -n "$cred" ]; then
  prefix="https://${cred}@github.com/"
  auth_args=(-c "url.${prefix}.insteadOf=git@github.com:" -c "url.${prefix}.insteadOf=https://github.com/")
else
  echo "   WARNING: no GitHub credential found; relying on existing git config"
fi

git submodule sync --recursive
if [ "${#auth_args[@]}" -gt 0 ]; then
  git "${auth_args[@]}" submodule update --init --recursive
else
  git submodule update --init --recursive
fi

echo "== bbi-sst (Bun / TypeScript) =="
( cd projects/bbi-sst && bun install )

echo "== bbi-accuzip-api (Python / uv) =="
( cd projects/bbi-accuzip-api && uv sync )

echo "== install complete =="
