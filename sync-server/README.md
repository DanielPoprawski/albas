# albas-sync

The server half of Albas sync. It is a **dumb row store**: opaque
`(account, table, primary key) -> payload` rows with a timestamp and a tombstone
flag. It never parses a to-do, an event or a weight reading, so adding a column
to the app never requires redeploying it.

One server can host **several people**. Each account has its own fully isolated
set of rows, unlocked by per-device bearer tokens; the token a device sends to
`/sync` is what decides whose data it reads and writes. There are no passwords
anywhere: people sign up and sign in from inside the app with a **passkey**
(security key, fingerprint, face unlock), which mints a token per device.
Accounts can also **share** their calendar and/or to-dos read-only with each
other — see Sharing below.

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
cat > .env <<EOF
ALBAS_SYNC_TOKEN=$(openssl rand -hex 32)
ALBAS_SYNC_ADMIN_TOKEN=$(openssl rand -hex 32)
ALBAS_SYNC_ORIGIN=https://albas-api.danni-dev.com
EOF
docker compose up -d
```

Updating later is `docker compose pull && docker compose up -d`.

`ALBAS_SYNC_TOKEN` is the **owner's personal sync token** — on startup it
creates (or re-keys) the account named `owner`, so it is both the bootstrap and
the rotation mechanism. It goes into Settings → Sync on each of the owner's own
devices. `ALBAS_SYNC_ADMIN_TOKEN` unlocks the `/accounts` endpoints below and
is never entered into the app. Both are credentials: send a token over
something private — not a repo, an issue, or email.

## Accounts and passkeys

An account is a name plus a set of credentials: **passkeys** (how a person
signs in) and **tokens** (what each signed-in device uses afterwards, one per
login, only SHA-256 hashes stored). With `ALBAS_SYNC_ORIGIN` set, anyone with
the server URL can create an account from the app's welcome screen: pick a
name, confirm with a security key / fingerprint / face unlock, done. Set
`ALBAS_SYNC_SIGNUPS=invite` to require an admin-minted invite code instead.

The WebAuthn ceremony runs inside the app (via the platform's authenticator);
the server only issues challenges and verifies responses, with the relying
party derived from `ALBAS_SYNC_ORIGIN`. Login is usernameless — the
authenticator identifies the account.

**Invites** (admin-only) cover two cases: signup passes when signups are locked
down, and *attaching a passkey to an account that already exists* — an invite
minted with that account's exact `name` is the only way, which is how the owner
enrolls a security key on the env-token-bootstrapped `owner` account:

```bash
curl -X POST https://albas-api.danni-dev.com/invites \
  -H "Authorization: Bearer $ALBAS_SYNC_ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"name": "owner"}'
# -> {"code":"3f9c…","name":"owner","expiresAt":…}   (single-use, 7 days)
```

The person enters the code in the app's Create-account screen. Invites without
a `name` are plain signup passes.

Token-only accounts still work for scripting or as a fallback — `POST
/accounts {"name":…}` (admin) returns a token shown exactly once, `GET
/accounts` lists names, and `DELETE /accounts/<name>` revokes an account, its
rows, tokens, passkeys and shares (devices keep their local data; it just
stops syncing). Account names are 1–64 of `a-z A-Z 0-9 - _`. Note that with
open signups, whether a name is taken is observable — treat names as public.

**Upgrading an older server:** nothing to do beyond pulling the new image.
A pre-account database is migrated in place — rows are assigned to the `owner`
account (created from `ALBAS_SYNC_TOKEN`, which must still be set for that
first start) with every `seq` preserved, so existing devices keep syncing with
the token they already have. A database from the brief accounts-with-inline-
tokens era gets its credentials moved into the `tokens` table, same guarantee.

## Sharing

An account can expose parts of its data to another account, **read-only**.
Grants are per table group — `calendar` (events, periods) and `todos` (to-dos
*and* habits: they live in the same table, so they share a toggle). Weight
data is never shareable, structurally. The app manages grants in Settings →
Sharing; the endpoints (account bearer token):

```
GET    /shares                 -> { "outgoing": [{name, calendar, todos}], "incoming": [...] }
PUT    /shares/<name>          body {"calendar": bool, "todos": bool}; both false removes
DELETE /shares/<name>          same as PUT false/false
```

Shared rows ride along in the `/sync` response (see Protocol). Every grant
change bumps the grantee's `grantRev`, which tells their next sync to rebuild
its shared cache from scratch — so a revoked share disappears from their app
on the next sync.

The container listens on `127.0.0.1:8787` only. A TLS-terminating reverse proxy
in front is mandatory, not optional — the bearer token is the sole credential, so
it must never cross a network in cleartext, and passkeys require real HTTPS.

This repo ships that proxy as a compose overlay: nginx plus certbot, with the
config templates in `nginx/`.

```bash
mkdir -p nginx/conf.d
cp nginx/bootstrap.conf nginx/conf.d/albas.conf     # HTTP only, so nginx can boot
docker compose -f docker-compose.yml -f docker-compose.nginx.yml up -d
docker compose -f docker-compose.yml -f docker-compose.nginx.yml \
  run --rm certbot certonly --webroot -w /var/www/certbot -d albas-api.danni-dev.com
cp nginx/tls.conf nginx/conf.d/albas.conf           # now the cert exists
docker compose -f docker-compose.yml -f docker-compose.nginx.yml restart nginx
```

Two things in those templates are load-bearing. `client_max_body_size 32m` —
nginx's 1 MB default rejects a first sync from a device with a lot of history as
a 413. And the ACME challenge location is deliberately *more specific* than `/`,
so `/.well-known/assetlinks.json` still falls through to the app, which is what
Android passkeys need.

Then in Albas: **Settings → Account & sync**. The current server is baked in as
the default, so signing in with a passkey needs no URL typed at all; the field
stays editable for anyone self-hosting their own.

### Building instead of pulling

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Without Docker at all: `cargo build --release`, then run
`target/release/albas-sync` with the environment variables below (a systemd unit
works well).

### Environment

| Variable                    | Default               | Notes                                                                    |
| --------------------------- | --------------------- | ------------------------------------------------------------------------ |
| `ALBAS_SYNC_TOKEN`          | *(unset)*             | Owner's sync token; creates/re-keys the `owner` account's env credential. Min 16 chars. |
| `ALBAS_SYNC_ADMIN_TOKEN`    | *(unset)*             | Enables the admin endpoints (`/accounts`, `/invites`). Min 16 chars.     |
| `ALBAS_SYNC_ORIGIN`         | *(unset)*             | Public https URL of this server; enables passkeys. `http://localhost:…` works for local testing. |
| `ALBAS_SYNC_SIGNUPS`        | `open`                | `open` = anyone with the URL can register; `invite` = invite code required. |
| `ALBAS_SYNC_ANDROID_ORIGIN` | *(unset)*             | Extra allowed WebAuthn origin (`android:apk-key-hash:…`) asserted by Android's Credential Manager. |
| `ALBAS_SYNC_ASSETLINKS`     | *(unset)*             | Raw JSON served at `/.well-known/assetlinks.json` (Android Digital Asset Links). |
| `ALBAS_SYNC_DB`             | `/data/albas-sync.db` | SQLite file. Back this up.                                               |
| `ALBAS_SYNC_ADDR`           | `0.0.0.0:8787`        | Listen address.                                                          |

On a fresh database there must be *some* way to end up with an account —
`ALBAS_SYNC_ORIGIN` (passkey signup), `ALBAS_SYNC_ADMIN_TOKEN`, or
`ALBAS_SYNC_TOKEN`; with none of the three the server refuses to start rather
than run uselessly.

## Protocol

The sync path is one endpoint, `POST /sync`, with
`Authorization: Bearer <token>` — the token identifies the account, and
everything below is scoped to it. (`/accounts` is admin-only bookkeeping and
carries no app data.)

```jsonc
// request
{
  "since": 41,                       // highest seq this device has applied; 0 on first sync
  "sharedSince": 41,                 // same idea, for rows shared *with* this account
  "grantRev": 3,                     // the grant revision this device last saw
  "changes": [
    { "tbl": "habits", "pk": "abc", "payload": { "name": "Run" },
      "updatedAt": 1753632000000, "deleted": false }
  ]
}

// response
{
  "seq": 43,                         // new watermark to store and send as `since` next time
  "changes": [ /* own rows changed by other devices since `since` */ ],
  "shared": [                        // rows other accounts shared with this one
    { "from": "sarah", "tbl": "events", "pk": "e1", "payload": { /* … */ },
      "updatedAt": 1753632000000, "deleted": false }
  ],
  "sharedSeq": 43,                   // watermark for the shared stream
  "grantRev": 3                      // echoed so the client can persist it
}
```

`sharedSince`/`grantRev` default to 0 when absent, so pre-sharing clients keep
working. When the client's `grantRev` doesn't match the server's (a share was
granted, changed or revoked since), `sharedSince` is ignored and the response
carries a **full shared snapshot** (tombstone-free); the client is expected to
wipe its shared cache before applying it. On a matching revision the pull is
incremental and does include tombstones.

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
