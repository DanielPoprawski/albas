#!/usr/bin/env bash
# Run `albas-sync admin …` on the deploy host, inside the running container.
#
#   scripts/admin.sh account list
#   scripts/admin.sh account create alice          # prints the token once
#   scripts/admin.sh share set alice bob --calendar --todos
#   scripts/admin.sh --help                        # the CLI's own help tree
#   scripts/admin.sh --sql                         # interactive sqlite3 on the live DB
#
# Same host and SSH multiplexing as publish.sh, so the passkey prompts once per
# ControlPersist window. The stack is the overlay (base + nginx) — `exec` only
# needs the service name, but both -f flags keep compose on the same project.
#
# Stopped server (or a container that won't start)? Run the CLI from a
# throwaway container on the same volume instead:
#
#   docker run --rm --user 10001:10001 \
#     -v albas-sync_albas-sync-data:/data -e ALBAS_SYNC_DB=/data/albas-sync.db \
#     ghcr.io/danielpoprawski/albas-sync:latest albas-sync admin account list
#
# `--user 10001:10001` is NOT optional. The image runs as uid 10001, and SQLite
# in WAL mode creates `-wal`/`-shm` files beside the database on first write.
# Created as root they are unwritable to the server, which then fails to open
# its own database on the next boot and the container crash-loops. (`docker
# compose exec` inherits the container's user, so the normal path below is
# safe by construction.)
set -euo pipefail

DEPLOY_HOST=${ALBAS_DEPLOY_HOST:?set ALBAS_DEPLOY_HOST=user@host}
# Where the compose files live on the host. The README's checkout layout is
# ~/albas/sync-server; publish.sh still targets the older ~/albas-sync.
DEPLOY_DIR=${ALBAS_DEPLOY_DIR:-albas/sync-server}
SSH_OPTS=(-o ControlMaster=auto -o "ControlPath=$HOME/.ssh/albas-publish-%r@%h" -o ControlPersist=120)
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.nginx.yml"

case "${1:-}" in
    --sql|sql)
        # -t/-it: an interactive prompt needs a TTY end to end. sqlite3 opens
        # the file directly (WAL: safe beside the running server); pass
        # `-readonly` after the path if you only mean to look.
        exec ssh -t "${SSH_OPTS[@]}" "$DEPLOY_HOST" \
            "cd ~/$DEPLOY_DIR && $COMPOSE exec -it albas-sync sqlite3 /data/albas-sync.db"
        ;;
esac

# -T: no TTY, so output pipes cleanly (`… account list --json | jq`). %q keeps
# labels with spaces and shell metacharacters intact across the ssh hop.
exec ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" \
    "cd ~/$DEPLOY_DIR && $COMPOSE exec -T albas-sync albas-sync admin $(printf '%q ' "$@")"
