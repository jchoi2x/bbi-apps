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
  for i in $(seq 1 30); do
    if [ -S /var/run/docker.sock ]; then break; fi
    sleep 1
  done
fi
# Allow the non-root agent user to reach the daemon socket.
if [ -S /var/run/docker.sock ]; then
  sudo chmod 666 /var/run/docker.sock || true
fi
docker version --format 'docker client {{.Client.Version}} / server {{.Server.Version}}' || {
  echo "Docker daemon did not come up; see /var/log/dockerd.log" >&2
  exit 1
}

echo "== Local Postgres for bbi-sst =="
( cd projects/bbi-sst && bun run db:up )

echo "== Apply Knex migrations =="
( cd projects/bbi-sst && KNEX_DEBUG=0 bun run db:migrate )

echo "== start complete =="
