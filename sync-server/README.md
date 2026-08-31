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
ALBAS_SYNC_ORIGIN=https://albas.danni-dev.com
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
curl -X POST https://albas.danni-dev.com/api/invites \
  -H "Authorization: Bearer $ALBAS_SYNC_ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"name": "owner"}'
# -> {"code":"3f9c…","name":"owner","expiresAt":…}   (single-use, 7 days)
```

The person enters the code in the app's Create-account screen. Invites without
a `name` are plain signup passes.

Token-only accounts still work for scripting or as a fallback — `POST
/accounts {"name":…}` (admin) returns a token shown exactly once, `GET
/accounts` lists every account with its tokens, passkeys and row count inline,
and `DELETE /accounts/<name>` revokes an account, its rows, tokens, passkeys
and shares (devices keep their local data; it just stops syncing). Account
names are 1–64 of `a-z A-Z 0-9 - _`. Note that with open signups, whether a
name is taken is observable — treat names as public.

**Invites are not planned to grow further.** The product direction is open
signup only — anyone with the server link can create an account — so
`POST /invites` (below) stays for `ALBAS_SYNC_SIGNUPS=invite` deployments and
for attaching a passkey to an existing account, but there is deliberately no
listing or revocation endpoint, and the admin console has no Invites panel.

### Self-service credentials

Everything above is admin-gated. Three routes let a signed-in person manage
their own credentials, authenticated by the same bearer token `/sync` uses —
the token *is* the identity, so no invite is involved and no admin is needed.

**Additional passkeys** — `POST /passkeys/start` and `POST /passkeys/finish`
run the same ceremony as `/register/*`, but take `account_id` from the token
instead of resolving a name and an invite. The start call sends the account's
existing credential ids as `exclude_credentials`, so an authenticator refuses
to silently enroll a second passkey for the same device. Finish re-checks that
the presented token still resolves to the account the pending ceremony was
started for, so one account cannot complete another's ceremony. `GET /passkeys`
lists what is attached as `{credId, label, createdAt}` — the table stores no
device name, so the label is derived from the credential id rather than
invented.

**Password** — `PUT /password` sets or changes one (Argon2id, PHC string in
`accounts.password_hash`; minimum 12 characters), `DELETE /password` removes it
but refuses with 409 if it is the account's only credential, and `GET
/password` reports `{set: bool}` and nothing else. `POST /login/password` is
the one unauthenticated route here: `{name, password, code?}` in, a minted
token out, the same shape passkey login returns. Unknown account and wrong
password give an identical 401 after an identical dummy verification, so the
response does not reveal whether a name exists.

**TOTP** — `POST /totp/enroll` generates a secret and returns it with an
`otpauth://` URI (the QR is drawn client-side from that URI; the server renders
no image), `POST /totp/confirm` verifies the first code and only then sets
`totp_confirmed`, `GET /totp` reports `{enrolled, confirmed}` without ever
echoing the secret, and `DELETE /totp` clears it. Re-enrolling while confirmed
is refused with 409 — any device holding a token could otherwise mint itself a
fresh QR without proving it has the current code.

**TOTP is a second factor for password login only.** `login/password` calls
`totp::verify_if_enrolled` after the password verifies; passkey login does not,
deliberately. A passkey is already possession plus user verification, and the
ceremony runs through the OS authenticator via a Tauri plugin that has nowhere
to prompt for a typed code. An account with no confirmed secret is unaffected
either way.

**Upgrading an older server:** nothing to do beyond pulling the new image.
Columns added to `accounts` after it first shipped (`grant_rev`,
`password_hash`, `totp_secret`, `totp_confirmed`) are backfilled by
`ensure_column` on every start — `CREATE TABLE IF NOT EXISTS` is a no-op on an
existing table, so each such column needs one, and adding a column to `accounts`
means adding a matching `ensure_column` call in `init_db`.
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

### Admin console

`web/` (the Bun + React app deployed alongside this server) drives a handful
of routes under `/admin/*`, all `admin_ok`-gated. They exist because the
self-service `/shares` trio above is scoped to whichever account the bearer
token identifies — an admin token names no account, so it needs its own
routes rather than a mode of those:

```
GET    /admin/shares                     -> [{ownerId, granteeId, ownerName, granteeName, calendar, todos}, ...]
PUT    /admin/shares/<owner>/<grantee>    body {"calendar": bool, "todos": bool}; both false removes
DELETE /admin/shares/<owner>/<grantee>    same as PUT false/false
GET    /admin/rows?account=&table=&limit= -> [{accountId, accountName, tbl, pk, updatedAt, deleted, seq}, ...]
                                             (no `account`/`table`, or "all", means unfiltered; limit defaults
                                             to 200, capped at 1000; never returns `payload`)
```

There is no free-form SQL endpoint — the console's query box filters the rows
already fetched from `/admin/rows` client-side, it does not reach the server.

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
  run --rm certbot certonly --webroot -w /var/www/certbot -d albas.danni-dev.com
cp nginx/tls.conf nginx/conf.d/albas.conf           # now the cert exists
docker compose -f docker-compose.yml -f docker-compose.nginx.yml restart nginx
```

### The server is a checkout of this repo

Clone the whole repo on the server and run compose from `sync-server/` inside
it, so config changes arrive by `git pull` instead of by hand-copied files that
drift from what is committed. Two things stay outside git and have to be put
there once:

- **`sync-server/.env`** — holds `ALBAS_SYNC_TOKEN` and friends. Never committed.
- **`sync-server/nginx/conf.d/albas.conf`** — a copy of `bootstrap.conf` or
  `tls.conf`. `conf.d/` is what compose mounts; `nginx/` is what git tracks.

`docker compose pull` cannot deliver either of those, or any config file: it
fetches container images, and the compose files and nginx config are host files
bind-mounted *into* stock containers at run time.

**Migrating an existing deployment into a checkout**, without losing the
database or the TLS certificates:

```bash
docker compose -f docker-compose.yml -f docker-compose.nginx.yml down   # no -v
git clone git@github.com:DanielPoprawski/albas.git ~/albas
cp ~/albas-sync/.env ~/albas/sync-server/.env
mkdir -p ~/albas/sync-server/nginx/conf.d
cp ~/albas-sync/nginx/conf.d/albas.conf ~/albas/sync-server/nginx/conf.d/
cd ~/albas/sync-server
docker compose -f docker-compose.yml -f docker-compose.nginx.yml up -d
```

The volumes survive that move only because `docker-compose.yml` pins
`name: albas-sync`. Compose namespaces named volumes by project name, which
otherwise defaults to the directory name — so the same stack under a directory
called `sync-server` would come up against an empty database and an empty
certbot volume rather than report an error. Confirm with `docker volume ls`:
the names are `albas-sync_albas-sync-data`, `albas-sync_certbot-etc` and
`albas-sync_certbot-www` both before and after. Keep `-v` off that `down`.

Once it is up, `~/albas-sync` can be deleted — but keep it until the site
answers and a sync round-trips.

### Deploying the public site

nginx serves the built site from `../web/dist` relative to the compose files —
the repo's own `web/dist`, mounted read-only at `/srv/albas`. `dist/` is
gitignored, so `git pull` never brings it; rsync it from a build:

```bash
cd web && bun run build                        # -> web/dist
rsync -a --delete dist/ user@host:albas/web/dist/
```

No nginx restart is needed — the mount is a directory, so new files are visible
immediately. Only `index.html` and `admin.html` are re-fetched; the `chunk-*`
files are content-hashed and served `immutable`, so a stale one can never be
picked up.

**One origin serves everything**: the JSON API under `/api`, Android's
assetlinks at the domain root, and the public splash/login/register page plus
`/admin` at `/`. That is deliberate — same-origin means the console never needs a CORS layer, and it puts
the WebAuthn relying party on this exact host rather than on the `danni-dev.com`
apex, where an Albas passkey would also be offerable to every other subdomain.

Three things in those templates are load-bearing:

- **The trailing slash on `proxy_pass http://albas-sync:8787/;`** is what strips
  the `/api` prefix, so the routes in `main.rs` are unchanged — the app still
  sees `/sync`, `/login/start` and the rest. A slashless `proxy_pass` breaks
  every endpoint at once.
- **`client_max_body_size 32m`** — nginx's 1 MB default rejects a first sync from
  a device with a lot of history as a 413.
- **`assetlinks.json` is matched exactly, at the root.** Android's Credential
  Manager fetches it from there and will not follow it anywhere else, so it
  cannot live under `/api`. The ACME challenge location is likewise more
  specific than `/`.

Then in Albas: **Settings → Account & sync**. The current server is baked in as
the default, so signing in with a passkey needs no URL typed at all; the field
stays editable for anyone self-hosting their own.

### Publishing a new image

```bash
./scripts/publish.sh
```

Runs the tests, builds `linux/amd64`, and pushes `:latest`, `:<short-sha>` and
`:<Cargo.toml version>` to GHCR. Then on the server, `docker compose pull &&
docker compose up -d`.

The GitHub Actions workflow does the same thing but is **manual only**
(`workflow_dispatch`). It builds `linux/arm64` as well, under QEMU emulation,
which takes around twenty minutes — worth it when an ARM image is actually
needed (a Pi-class home box), not on every push. It also publishes without
running the crate's tests; the script does not.

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
| `ALBAS_SYNC_ADMIN_TOKEN`    | *(unset)*             | Enables the admin endpoints (`/accounts`, `/admin/*`, `/invites`). Min 16 chars. |
| `ALBAS_SYNC_ORIGIN`         | *(unset)*             | Public https **origin** — scheme and host only, no `/api` path. The WebAuthn relying party is its host, so changing it invalidates every existing passkey. Unset disables passkeys. `http://localhost:…` works for local testing. |
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
