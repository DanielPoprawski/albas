# albas-sync

The server half of Albas sync. It is a **dumb row store**: opaque
`(table, primary key) -> payload` rows with a timestamp and a tombstone flag. It
never parses a to-do, an event or a weight reading, so adding a column to the app
never requires redeploying it.

Albas stays local-first — SQLite on the device remains the source of truth, every
edit is made offline, and this server only reconciles devices when one is
reachable.

## Running it

Images are published to `ghcr.io/danielpoprawski/albas-sync` by
`.github/workflows/sync-server.yml` (amd64 and arm64), so hosting needs neither a
clone nor a Rust toolchain — only `docker-compose.yml` and a token.

```bash
mkdir albas-sync && cd albas-sync
curl -O https://raw.githubusercontent.com/DanielPoprawski/albas/main/sync-server/docker-compose.yml
echo "ALBAS_SYNC_TOKEN=<token from the app's owner>" > .env
docker compose up -d
```

Updating later is `docker compose pull && docker compose up -d`.

> **Generating the token:** `openssl rand -hex 32`, done once by whoever owns the
> app. The same value goes in this `.env` *and* into Settings → Sync on every
> device. It is the only credential protecting the data, so send it over
> something private — not a repo, an issue, or email.

The container listens on `127.0.0.1:8787` only. Put a TLS-terminating reverse
proxy in front — the bearer token is the sole credential, so it must never cross
a network in cleartext. With Caddy that is one line:

```
sync.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Then in Albas: **Settings → Sync**, enter `https://sync.example.com/sync` and the
token. Do the same on every device, using the same token.

### Building instead of pulling

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Without Docker at all: `cargo build --release`, then run
`target/release/albas-sync` with the environment variables below (a systemd unit
works well).

### Environment

| Variable            | Default                | Notes                                     |
| ------------------- | ---------------------- | ----------------------------------------- |
| `ALBAS_SYNC_TOKEN`  | *(required)*           | Shared bearer token. Minimum 16 chars.    |
| `ALBAS_SYNC_DB`     | `/data/albas-sync.db`  | SQLite file. Back this up.                |
| `ALBAS_SYNC_ADDR`   | `0.0.0.0:8787`         | Listen address.                           |

## Protocol

One endpoint, `POST /sync`, with `Authorization: Bearer <token>`.

```jsonc
// request
{
  "since": 41,                       // highest seq this device has applied; 0 on first sync
  "changes": [
    { "tbl": "habits", "pk": "abc", "payload": { "name": "Run" },
      "updatedAt": 1753632000000, "deleted": false }
  ]
}

// response
{
  "seq": 43,                         // new watermark to store and send as `since` next time
  "changes": [ /* rows changed by other devices since `since` */ ]
}
```

`GET /health` returns `ok`.

### The two clocks

- **`updatedAt`** comes from the device that made the edit and decides *who
  wins*: an incoming row is applied only when it is strictly newer than the
  stored one (last-write-wins). It is only as good as that device's clock, which
  is fine for choosing between two edits to the same row.
- **`seq`** is assigned here, strictly increasing, and decides *what a device has
  yet to see*. Clients resume from it, so a wrong clock on some device can never
  cause another to skip a row.

A rejected (stale) write does not advance the row's `seq`, so devices are not
woken up for a change that did not happen.

### Echo suppression

The pull snapshot is taken *before* the push is applied, inside one transaction.
A device therefore never receives its own writes back, and a concurrent write
from another device either committed before the snapshot (and is included) or
gets a higher `seq` (and arrives next time).

### Conflict granularity

Last-write-wins is **per row**, not per field. Two devices editing different
fields of the same to-do while both offline will keep only the later edit
wholesale. For a single user across a couple of devices this is nearly always
what you want; if it ever isn't, the merge rule lives in one `ON CONFLICT …
WHERE` clause in `src/main.rs`.

## What is not synced

Settings. On Android the Wyze credentials live in the app's `meta` table under
`setting:__wyze_credentials`, because there is no keyring backend there — syncing
settings wholesale would upload a plaintext password. Sync configuration
(`__sync_url`, `__sync_token`) is excluded for the same reason, and preferences
like `theme` are arguably per-device anyway.

To sync a subset later, give `meta` its own `updated_at`/`deleted` columns and add
it to `TABLES` in `src-tauri/src/sync.rs`, keeping the `__` prefix excluded.

## Tests

```bash
cargo test                     # server: token comparison and the merge rule
```

The client's half, including a live two-device round trip:

```bash
cd ../src-tauri
cargo test --lib                                        # offline unit tests
ALBAS_SYNC_TEST_URL=http://127.0.0.1:8787/sync \
  ALBAS_SYNC_TEST_TOKEN=… cargo test --lib -- --ignored # against a throwaway server
```
