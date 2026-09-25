#!/usr/bin/env bash
# Cloud Agent install: idempotent repository bootstrap for the bbi-apps monorepo.
# Runs after the repo is checked out. System tools (bun, uv, docker, php,
# terraform, node, python) are baked into the base snapshot; this script only
# refreshes source-derived state (submodules + per-project dependencies).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export PATH="$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

echo "== Resolve git submodules over token HTTPS =="
# .gitmodules pins git@github.com: SSH URLs; the Cloud Agent authenticates over
# HTTPS with a scoped token, so rewrite SSH GitHub URLs to HTTPS for this run.
git config --global url."https://github.com/".insteadOf "git@github.com:"
git submodule sync --recursive
git submodule update --init --recursive

echo "== bbi-sst (Bun / TypeScript) =="
( cd projects/bbi-sst && bun install )

echo "== bbi-accuzip-api (Python / uv) =="
( cd projects/bbi-accuzip-api && uv sync )

echo "== install complete =="
