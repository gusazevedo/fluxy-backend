#!/usr/bin/env bash
# Ensure the Docker daemon is running before we try to start containers.
# If it's down, start it (macOS: Docker Desktop) and wait until it responds.
set -euo pipefail

if docker info >/dev/null 2>&1; then
  exit 0
fi

echo "Docker daemon is not running — attempting to start it..."

case "$(uname -s)" in
  Darwin)
    open -a Docker
    ;;
  Linux)
    # Best effort: needs a systemd-based distro and sudo privileges.
    sudo systemctl start docker || true
    ;;
  *)
    echo "Unsupported OS: please start Docker manually." >&2
    exit 1
    ;;
esac

printf "Waiting for Docker to be ready"
for _ in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    echo " ready."
    exit 0
  fi
  printf "."
  sleep 2
done

echo
echo "Timed out waiting for Docker to start." >&2
exit 1
