#!/usr/bin/env bash
# Cloud Agent start: per-boot runtime initialization. Brings up the Docker
# daemon (no systemd in the VM), the local Postgres used by bbi-sst tests /
# sst dev, and applies Knex migrations. Idempotent and safe to re-run.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export PATH="$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

echo "== Start Docker daemon =="
if ! docker info >/dev/null 2>&1; then
  sudo mkdir -p /var/log
  # dockerd must run detached; there is no systemd in the Cloud Agent VM.
  sudo bash -c 'nohup dockerd >/var/log/dockerd.log 2>&1 &'
fi
# Wait until the daemon actually SERVES requests (not just until the socket
# file exists) — a cold boot creates the socket before the server is ready.
docker_ready=0
for i in $(seq 1 60); do
  # Loosen socket perms as soon as it appears so the non-root agent can connect.
  [ -S /var/run/docker.sock ] && sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
  if docker info >/dev/null 2>&1; then
    docker_ready=1
    break
  fi
  sleep 1
done
if [ "$docker_ready" -ne 1 ]; then
  echo "Docker daemon did not become ready; see /var/log/dockerd.log" >&2
  exit 1
fi
docker version --format 'docker client {{.Client.Version}} / server {{.Server.Version}}'

echo "== Local Postgres for bbi-sst =="
( cd projects/bbi-sst && bun run db:up )

echo "== Apply Knex migrations =="
( cd projects/bbi-sst && KNEX_DEBUG=0 bun run db:migrate )

echo "== start complete =="
