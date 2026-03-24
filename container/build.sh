#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="${LEANCLAW_CONTAINER_IMAGE:-leanclaw-agent:latest}"

echo "Building LeanClaw agent container: ${IMAGE_NAME}"

docker build \
  -t "${IMAGE_NAME}" \
  -f "${SCRIPT_DIR}/Dockerfile" \
  "${SCRIPT_DIR}"

echo "Built: ${IMAGE_NAME}"
docker images "${IMAGE_NAME}" --format '{{.Repository}}:{{.Tag}} {{.Size}}'
