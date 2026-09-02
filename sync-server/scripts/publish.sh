#!/usr/bin/env bash
# Build and push the sync-server image to GHCR, amd64 only — the routine publish
# path. The deploy server is x86; for the rare multi-arch (arm64) build, dispatch
# the "sync-server image" GitHub Actions workflow instead.
#
# Prereq: docker login ghcr.io  (username + a PAT with write:packages)
#
# After pushing, deploys over SSH: pulls the new image on the server and
# restarts the compose project. SSH auth is interactive (passkey touch/PIN) —
# that prompt is expected. Pass --build-only to skip the deploy.
set -euo pipefail

DEPLOY_HOST=daniel@ssh.danni-dev.com
DEPLOY=1
[[ "${1:-}" == "--build-only" ]] && DEPLOY=0

cd "$(dirname "$0")/.."

IMAGE=ghcr.io/danielpoprawski/albas-sync
VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)
SHA=$(git rev-parse --short HEAD)

if [[ -z "$VERSION" ]]; then
    echo "error: could not read version from Cargo.toml" >&2
    exit 1
fi
if [[ -n "$(git status --porcelain -- .)" ]]; then
    echo "warning: sync-server/ has uncommitted changes; sha-$SHA tag will not match the image contents" >&2
fi

echo "Building $IMAGE ($VERSION, sha-$SHA, linux/amd64)"
docker build --platform linux/amd64 \
    -t "$IMAGE:latest" \
    -t "$IMAGE:$VERSION" \
    -t "$IMAGE:sha-$SHA" \
    .

for tag in latest "$VERSION" "sha-$SHA"; do
    docker push "$IMAGE:$tag" || {
        echo "push failed — are you logged in? try: docker login ghcr.io" >&2
        exit 1
    }
done

echo "Published $IMAGE:{latest,$VERSION,sha-$SHA}"

if [[ $DEPLOY -eq 0 ]]; then
    echo "Skipping deploy (--build-only). On the server: docker compose pull && docker compose up -d"
    exit 0
fi

# The web console is static files served by nginx from ~/albas-sync/web on the
# host — the image pull never updates it, so rebuild and upload it here.
echo "Building web console"
(cd ../web && bun run build)

# One multiplexed SSH connection covers the rsync and the ssh below, so the
# passkey prompts once rather than per command.
SSH_OPTS=(-o ControlMaster=auto -o "ControlPath=$HOME/.ssh/albas-publish-%r@%h" -o ControlPersist=120)

echo "Deploying to $DEPLOY_HOST (SSH may prompt for your passkey)"
rsync -az --delete -e "ssh ${SSH_OPTS[*]}" ../web/dist/ "$DEPLOY_HOST:albas-sync/web/"

# The stack runs as an overlay (docker-compose.yml + docker-compose.nginx.yml) —
# both -f flags are required, `up -d` with only the base file would drop nginx.
ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" bash -s <<'REMOTE'
set -euo pipefail
cd ~/albas-sync
docker compose -f docker-compose.yml -f docker-compose.nginx.yml pull albas-sync
docker compose -f docker-compose.yml -f docker-compose.nginx.yml up -d
docker image prune -f >/dev/null
REMOTE

echo "Deployed."
