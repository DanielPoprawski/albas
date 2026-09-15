# albas-sync

The server half of Albas sync. It is a **dumb row store**: opaque
`(account, table, primary key) -> payload` rows with a timestamp and a tombstone
flag. It never parses a to-do or an event, so adding a column
to the app never requires redeploying it.

One server can host **several people**. Each account has its own fully isolated
set of rows, unlocked by per-device bearer tokens; the token a device sends to
`/sync` is what decides whose data it reads and writes. People sign up and sign
in from inside the app with a **username and password**; a **passkey** (security
key, fingerprint, face unlock) and a **TOTP** second factor can be added
afterwards from the web sign-in site. Every login mints a token per device.
Accounts can also **share** their calendar and/or to-dos read-only with each
other — see Sharing below.

Albas stays local-first — SQLite on the device remains the source of truth, every
edit is made offline, and this server only reconciles devices when one is
reachable.

## Running it

Images are published to `ghcr.io/danielpoprawski/albas-sync` by
`scripts/publish.sh` (amd64, built locally and pushed), so hosting needs neither a
clone nor a Rust toolchain — only `docker-compose.yml` and a token. The manual
`.github/workflows/sync-server.yml` workflow remains for the rare multi-arch
(arm64) build.

```bash
mkdir albas-sync && cd albas-sync
curl -O https://raw.githubusercontent.com/DanielPoprawski/albas/main/sync-server/docker-compose.yml
cat > .env <<EOF
ALBAS_SYNC_TOKEN=$(openssl rand -hex 32)
ALBAS_SYNC_ORIGIN=https://albas.danni-dev.com
ALBAS_SYNC_KEK=$(openssl rand -base64 32)
EOF
docker compose up -d
```

Updating later is `docker compose pull && docker compose up -d`.

`ALBAS_SYNC_TOKEN` is the **owner's personal sync token** — on startup it
creates (or re-keys) the account named `owner`, so it is both the bootstrap and
the rotation mechanism. It goes into Settings → Sync on each of the owner's own
devices. It is a credential: send a token over something private — not a
repo, an issue, or email. There is no separate admin token — administration is
the `albas-sync admin` CLI run inside the container (see "Admin CLI" below).

## Accounts and credentials

An account is a name plus a set of credentials: a **password** (the mandatory
first one, Argon2id), optional **passkeys** and a **TOTP** second factor, and
**tokens** (what each signed-in device uses afterwards, one per login, only
SHA-256 hashes stored). Anyone with the server URL can create an account from
the app's welcome screen: pick a name and a password, done. Set
`ALBAS_SYNC_SIGNUPS=invite` to require an admin-minted invite code instead.

WebAuthn ceremonies run in the system browser on the public site (`web/`); the
app itself holds no WebAuthn code and receives the result through the
`/app-session` handoff (`src/app_session.rs`). The server only issues
challenges and verifies responses, with the relying party derived from
`ALBAS_SYNC_ORIGIN`. Passkey login is usernameless — the authenticator
identifies the account.

**Invites** (admin-minted) cover two cases: signup passes when signups are
locked down, and *attaching a passkey through the legacy `/register/*` passkey
ceremony to an account that already exists* — an invite minted with that
account's exact name unlocks it, which is how an env-token-bootstrapped `owner`
account with no password can still get a credential (a signed-in person adds
passkeys self-service instead — see below):

```bash
scripts/admin.sh invite create --name owner
# code: 3f9c…   single-use, expires in 7 days
```

The person enters the code in the app's Create-account screen. Invites without
`--name` are plain signup passes.

Token-only accounts still work for scripting or as a fallback — `albas-sync
admin account create <name>` prints a token exactly once. Account names are
1–64 of `a-z A-Z 0-9 - _`. Note that with open signups, whether a name is taken
is observable — treat names as public.

### Admin CLI

There is no admin HTTP surface and no admin token: the web console and the
`/accounts`, `/admin/*` and `/invites` routes were removed (2026-09). Server
administration is `albas-sync admin …`, a subcommand of the server binary that
opens the same SQLite file directly (`src/admin.rs`, a thin shell over the
`*_db` functions in `main.rs`). It runs inside the container; `scripts/admin.sh`
is the ssh + `docker compose exec` wrapper, with the same host and SSH
multiplexing as `publish.sh`:

```bash
scripts/admin.sh account list
scripts/admin.sh --help
```

| Command | Effect |
|---|---|
| `account list [--json]` | Every account with its tokens, passkeys, row count and `hasPassword` / `totpEnabled` / `googleEmail` flags. `--json` is the old `GET /accounts` shape. |
| `account create <name>` | Token-only account; prints the bearer token exactly once (only its hash is stored). |
| `account rename <name> <new>` | Refused for `owner` in either direction (`upsert_owner` finds it by name at boot) and on a taken name. Bumps every grantee's `grant_rev`, since shared snapshots cache rows under the owner's name. |
| `account delete <name>` | Removes the account, its rows, tokens, passkeys and shares in both directions (devices keep their local data; it just stops syncing). Grantees' `grant_rev` is bumped first. |
| `passkey label <account> <id> [label]` | Set a passkey's display label; no label clears back to the derived `Passkey <prefix>` name. |
| `passkey delete <account> <id>` | Refused when it is the last passkey and no password or Google link remains — nothing can mint a token for an *existing* account, so that would brick it; delete the account instead. |
| `token revoke <account> <id>` | Signs that device out on its next sync. |
| `password clear <account>` | Idempotent; refused when the password is the only credential — a passkey or Google link must remain. |
| `totp clear <account>` | Idempotent, never guarded: TOTP is only a second factor, so this is the recovery move for a lost authenticator. |
| `share list [--json]` | Every grant on the server (the self-service `/shares` only sees the caller's). |
| `share set <owner> <grantee> [--calendar] [--todos]` | Upsert a grant; no scope flag removes it. Bumps the grantee's `grant_rev` either way. |
| `share remove <owner> <grantee>` | Same as `set` with no flags. |
| `invite create [--name <account>]` | Single-use code, 7 days. With `--name`, attaches a passkey to that existing account; without, a plain signup pass for `ALBAS_SYNC_SIGNUPS=invite`. |
| `health` | Exit 0 if the local server answers `/health` (also `albas-sync health`, for a container healthcheck — the image has no curl). |

Exit codes: 0 ok, 1 refused or failed (reason on stderr), 2 usage. Every write
is one transaction, and the CLI waits up to 5 s for the server's write lock
rather than failing on a busy database. Ids come from `account list`.

**Reading anything else** — browsing rows, tombstone counts, ad-hoc queries, a
consistent backup — is a `sqlite3` session on the live database (the image
ships `sqlite3`; WAL mode makes concurrent reads safe beside the server):

```bash
scripts/admin.sh --sql
sqlite> SELECT a.name, r.tbl, COUNT(*) FROM rows r JOIN accounts a ON a.id = r.account_id GROUP BY 1, 2;
sqlite> .backup /data/albas-sync.backup.db      -- consistent even mid-write; then docker cp it out
```

Two caveats:

- **Stay uid 10001.** `docker compose exec` inherits the container's user. If
  the server is stopped and you `docker run` the image against the volume
  instead, pass `--user 10001:10001` — SQLite creates `-wal`/`-shm` files next
  to the database on first write, and root-owned ones make the server fail to
  open its database on the next boot. The exact fallback command, and why, is
  in `scripts/admin.sh`'s header.
- **Delete the old secret.** After deploying this version, remove
  `ALBAS_SYNC_ADMIN_TOKEN` from the VM's `.env` — nothing reads it any more.

**Invites are not planned to grow further.** The product direction is open
signup only — anyone with the server link can create an account — so `invite
create` stays for `ALBAS_SYNC_SIGNUPS=invite` deployments and for attaching a
passkey to an existing account, but there is deliberately no listing or
revocation command.

### Self-service credentials

Everything above is operator-only. Three routes let a signed-in person manage
their own credentials, authenticated by the same bearer token `/sync` uses —
the token *is* the identity, so no invite is involved and no admin is needed.

**Additional passkeys** — `POST /passkeys/start` and `POST /passkeys/finish`
run the same ceremony as `/register/*`, but take `account_id` from the token
instead of resolving a name and an invite. The start call sends the account's
existing credential ids as `exclude_credentials`, so an authenticator refuses
to silently enroll a second passkey for the same device. Finish re-checks that
the presented token still resolves to the account the pending ceremony was
started for, so one account cannot complete another's ceremony. `GET /passkeys`
lists what is attached as `{credId, label, createdAt}` — `label` is the
admin-set name when one exists, otherwise derived from the credential id (the
server never learns a device name on its own).

**Password** — `PUT /password` sets or changes one (Argon2id, PHC string in
`accounts.password_hash`; 12–128 characters), `DELETE /password` removes it
but refuses with 409 if it is the account's only credential, and `GET
/password` reports `{set: bool}` and nothing else. `POST /login/password` is
the one unauthenticated route here: `{name, password, code?, recoveryCode?}`
in (`code` and `recoveryCode` only matter when TOTP is confirmed — see below),
a minted token out, the same shape passkey login returns. Unknown account and
wrong password give an identical 401 after an identical dummy verification, so
the response does not reveal whether a name exists.

**TOTP** — `POST /totp/enroll` takes `{password}` (re-verified — proves the
caller still has it, not just a bearer token, before minting a new secret),
generates a secret, and returns it once with an `otpauth://` URI (the QR is
drawn client-side from that URI; the server renders no image). The secret is
stored encrypted at rest (AES-256-GCM under `ALBAS_SYNC_KEK`, see Environment
below) — enrollment 503s if that key isn't configured, rather than falling
back to plaintext. `POST /totp/confirm` `{code}` verifies the first code, sets
`totp_confirmed`, and returns eight one-time **recovery codes**
(`xxxxx-xxxxx`, only SHA-256 hashes stored) — shown exactly once, for when the
authenticator itself is unavailable; `login/password` accepts one via
`recoveryCode` in place of `code`, single-use. `GET /totp` reports `{enrolled,
confirmed}` without ever echoing the secret, and `DELETE /totp` clears the
secret, confirmation, and any unused recovery codes. Re-enrolling while
confirmed is refused with 409 — any device holding a token could otherwise
mint itself a fresh QR without proving it has the current code. A code (or
recovery code) that already verified once for its 30-second step is rejected
on a second presentation — replay protection, not just numeric correctness.

**TOTP is a second factor for password login only.** `login/password` calls
`totp::verify_if_enrolled` after the password verifies; passkey login does not,
deliberately — a passkey is already possession plus user verification. An
account with no confirmed secret is unaffected either way.

**Sessions** — `GET /tokens` lists this account's bearer tokens
(`{id, label, createdAt, expiresAt, lastUsedAt, current}`), `DELETE
/tokens/current` revokes the one the request itself used (what `sync_sign_out`
calls, best-effort, before clearing local state), `DELETE /tokens/<id>`
revokes another by id, and `DELETE /tokens` revokes every token *except* the
current one — "sign out everywhere else". Every token has a 90-day sliding
idle expiry: `account_for` extends it (at most once an hour, to avoid a write
on every request) whenever the token is actually used, so an active device
never has to re-authenticate but an abandoned one eventually stops working on
its own even without an explicit revoke.

**Account deletion and export** — `DELETE /account` `{password}` deletes the
signed-in account and everything anchored to it (rows, tokens, passkeys,
shares, TOTP state), the self-service twin of `albas-sync admin account delete`
but re-verifying the password first rather than trusting whoever holds a shell.
`GET /account/export` returns every non-deleted row the account owns as JSON,
payloads included — this is the account owner asking for their own data back.

## Rate limiting and lockout

Two independent layers: **per-IP** (nginx's `limit_req_zone` in
`nginx/tls.conf`, and — in case nginx is ever bypassed or the app is run
without it, e.g. `cargo run` behind a plain reverse proxy or none at all — a
`tower_governor` layer in `main.rs` on the same routes, 10 requests/minute
sustained with a burst of 20, keyed on `X-Forwarded-For`/`X-Real-IP`/
`Forwarded` with a peer-address fallback) covers login, register, TOTP,
app-session and Google OAuth start/callback — the routes an unauthenticated
caller can hit. **Per-account** (`auth_failures` table, `lockout.rs`) covers
password and TOTP verification specifically: ten wrong attempts locks that
credential (password *or* TOTP — independently) for fifteen minutes, reset by
any success. A locked-out request gets `423 Locked`; a rate-limited one gets
`429 Too Many Requests`.

**Upgrading an older server:** nothing to do beyond pulling the new image.
Columns added to tables after they first shipped (`accounts.grant_rev`,
`password_hash`, `totp_secret`, `totp_confirmed`, `google_email`;
`passkeys.label`; `tokens.expires_at`, `tokens.last_used_at`) are backfilled by
`ensure_column` on every start — `CREATE TABLE IF NOT EXISTS` is a no-op on an
existing table, so each such column needs one, and adding a column to a
shipped table means adding a matching `ensure_column` call in `init_db`. A
token from before `expires_at` existed backfills to 0 (already expired) —
that device just signs in again; a token minted or migrated in the same
upgrade transaction (the owner's env token, and any token carried over by the
legacy-schema migrations below) gets a fresh 90-day expiry instead, since
those are credentials someone is actively depending on right now, not a blank
"new column" default.
A pre-account database is migrated in place — rows are assigned to the `owner`
account (created from `ALBAS_SYNC_TOKEN`, which must still be set for that
first start) with every `seq` preserved, so existing devices keep syncing with
the token they already have. A database from the brief accounts-with-inline-
tokens era gets its credentials moved into the `tokens` table, same guarantee.

## Sharing

An account can expose parts of its data to another account, **read-only**.
Grants are per table group — `calendar` (events, periods) and `todos` (to-dos
*and* habits: they live in the same table, so they share a toggle). The app manages grants in Settings →
Sharing; the endpoints (account bearer token):

```
GET    /shares                 -> { "outgoing": [{name, calendar, todos}], "incoming": [...] }
PUT    /shares/<name>          body {"calendar": bool, "todos": bool}; both false removes
DELETE /shares/<name>          same as PUT false/false
```

`PUT`/`DELETE /shares/<name>` always answer `200 {"ok": true}` on success —
and, for a `<name>` that doesn't exist, `200 {"ok": false}` rather than `404`.
A 404 here would let anyone with a bearer token enumerate which account names
exist on the server just by trying to share with them; deliberately answering
the same way (200) whether the name is real or not closes that off, at the
cost of the client having to check `ok` instead of the HTTP status.

Shared rows ride along in the `/sync` response (see Protocol). Every grant
change bumps the grantee's `grantRev`, which tells their next sync to rebuild
its shared cache from scratch — so a revoked share disappears from their app
on the next sync.

### Administering shares

The `/shares` trio above is scoped to whichever account the bearer token
identifies. To list every grant on the server or edit one between two named
accounts, use the CLI — `share list`, `share set <owner> <grantee>
[--calendar] [--todos]`, `share remove` (see "Admin CLI"). Same
upsert-or-delete rule, same `grant_rev` bump on the grantee.

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
immediately. Only `index.html` is re-fetched; the `chunk-*`
files are content-hashed and served `immutable`, so a stale one can never be
picked up.

**One origin serves everything**: the JSON API under `/api`, Android's
assetlinks at the domain root, and the public splash/login/register page at
`/`. That is deliberate — same-origin means the site never needs a CORS layer,
and it puts the WebAuthn relying party on this exact host rather than on the `danni-dev.com`
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
| `ALBAS_SYNC_ORIGIN`         | *(unset)*             | Public https **origin** — scheme and host only, no `/api` path. The WebAuthn relying party is its host, so changing it invalidates every existing passkey. Unset disables passkeys. `http://localhost:…` works for local testing. |
| `ALBAS_SYNC_SIGNUPS`        | `open`                | `open` = anyone with the URL can register; `invite` = invite code required. |
| `ALBAS_SYNC_ANDROID_ORIGIN` | *(unset)*             | Extra allowed WebAuthn origin (`android:apk-key-hash:…`) asserted by Android's Credential Manager. |
| `ALBAS_SYNC_ASSETLINKS`     | *(unset)*             | Raw JSON served at `/.well-known/assetlinks.json` (Android Digital Asset Links). |
| `ALBAS_SYNC_DB`             | `/data/albas-sync.db` | SQLite file, shared by the server and `albas-sync admin`. Back this up (`.backup` under "Admin CLI"). |
| `ALBAS_SYNC_ADDR`           | `0.0.0.0:8787`        | Listen address.                                                          |
| `ALBAS_SYNC_GOOGLE_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` | *(unset)* | Google OAuth (server-side confidential client, `google.rs`). All three or none; unset hides the Google button (`GET /auth/config`). |
| `ALBAS_SYNC_KEK`            | *(unset)*             | Base64 of exactly 32 raw bytes — the key TOTP secrets are encrypted under at rest (AES-256-GCM). Generate with `openssl rand -base64 32`. Unset means `POST /totp/enroll` refuses with 503 rather than storing a secret in the clear; set but not 32 base64 bytes refuses to boot; an *existing* encrypted secret that can't be decrypted (unset/rotated/corrupted) fails TOTP verification closed, logging the reason server-side rather than exposing it. Losing or rotating this key without a plan makes every enrolled account's TOTP unverifiable — `albas-sync admin totp clear <name>` is the recovery, same as a lost authenticator. |

On a fresh database the startup guard insists on *some* way to end up with an
account — `ALBAS_SYNC_ORIGIN` or `ALBAS_SYNC_TOKEN`, or one created beforehand
with `albas-sync admin account create <name>` (the CLI initialises the schema
itself, so it works on an empty volume); with none of those the server refuses
to start rather than run uselessly. Password signup itself needs neither, so in
practice `ALBAS_SYNC_ORIGIN` is always set.

## Protocol

The sync path is one endpoint, `POST /sync`, with
`Authorization: Bearer <token>` — the token identifies the account, and
everything below is scoped to it.

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
WHERE` clause in `src/sync.rs`.

## What is not synced

Settings. They are device-local preferences (`theme`, layout widths, the
endpoint itself) plus local-only markers such as `__sync_url` and
`__sync_token`, so syncing them wholesale would be wrong on every device but
the one that wrote them.

To sync a subset later, give `meta` its own `updated_at`/`deleted` columns and add
it to `TABLES` in `src-tauri/src/sync.rs`, keeping the `__` prefix excluded.

## Source layout

`src/main.rs` is the process: `Config` in, router out, plus `AppState` and its
`db()` (every handler's SQLite and Argon2 work runs on tokio's blocking pool
under the one connection lock). The cross-cutting pieces have a module each:
`config.rs` (every environment variable, read once), `schema.rs` (the tables,
`open`, `init_db`, `ensure_column`, legacy migrations), `auth.rs` (tokens and
the `Authed` extractor that guards every authenticated route), `error.rs` (the
one `(StatusCode, String)` shape every handler returns; 500s log the cause and
send a generic line), `admin_db.rs` (the `*_db` helpers the CLI shares). The
rest is one module per route group: `sync.rs` (`POST /sync` and its wire
types, the merge rule), `shares.rs`, `tokens.rs`, `account.rs` (name rules,
delete/export), `passkey.rs`, `password.rs`, `totp.rs`, `google.rs`,
`app_session.rs` (the browser → app handoff), `lockout.rs`, `admin.rs` (the
CLI), `tests.rs`.

## Tests

```bash
cargo test                     # src/tests.rs: merge rule, sharing, tokens, routes, schema; per-module handler tests
```

The client's half, including a live two-device round trip:

```bash
cd ../src-tauri
cargo test --lib                                        # offline unit tests
ALBAS_SYNC_TEST_URL=http://127.0.0.1:8787/sync \
  ALBAS_SYNC_TEST_TOKEN=… cargo test --lib -- --ignored # against a throwaway server
```
