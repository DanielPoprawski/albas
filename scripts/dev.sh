#!/usr/bin/env bash
# Interactive launcher for Albas build/dev commands. Requires gum (https://github.com/charmbracelet/gum).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

declare -A CMDS=(
  ["app · desktop dev"]="cd '$ROOT' && bun run tauri dev"
  ["app · desktop build + install (~/.local/bin/albas)"]="cd '$ROOT' && bun run app:desktop"
  ["app · android build + install + launch"]="cd '$ROOT' && bun run app:android"
  ["app · clean rebuildable caches (~27G)"]="cd '$ROOT' && bun run clean"
  ["sync-server · cargo run"]="cd '$ROOT/sync-server' && cargo run"
  ["sync-server · cargo check"]="cd '$ROOT/sync-server' && cargo check --message-format=short"
  ["sync-server · publish image (GHCR)"]="cd '$ROOT/sync-server' && ./scripts/publish.sh"
)

# gum 2.0 falls back to a light-theme adaptive style (dark-on-white) when it
# can't detect the terminal background; explicitly blanking each element's
# style disables that, leaving plain terminal-default text everywhere except
# the cursor line.
choice="$(printf '%s\n' "${!CMDS[@]}" | sort | gum filter \
  --placeholder 'Run what?' --height 16 \
  --indicator '→' \
  --text.foreground='' --text.background='' \
  --cursor-text.foreground=212 --cursor-text.background='' \
  --match.foreground=212 --match.background='' \
  --prompt.foreground='' --prompt.background='' \
  --placeholder.background='' \
  --indicator.foreground=212 --indicator.background='')" || exit 0

gum style --foreground 212 "→ $choice"
eval "${CMDS[$choice]}"
