#     ___     ____
#    /   |   / / /_  ____ ______
#   / /| |  / / __ \/ __ `/ ___/
#  / ___ | / / /_/ / /_/ (__  )
# /_/  |_|/_/_.___/\__,_/____/
#
**The ultimate productivity suite** — for managing your schedule, keeping track of chores
and errands, and building your habits.

Albas is a **local-first** desktop and Android app. SQLite on the device is the source of
truth: every edit is made offline, nothing needs a network, and an optional self-hosted sync
server exists only to reconcile your devices with each other. No account is required to use
it, and no data leaves the machine unless you set sync up yourself.

---

## What's in it

- **Calendar** — month, week and day views, built as a custom grid rather than a calendar
  library. Multi-day events render as lanes across the month; the phone grid is swipeable.
- **To-dos, habits and chores** — one unified model, distinguished only by their schedule.
  A one-off is a task, a fixed cadence is a habit, and "every N days from when I last did it"
  is a chore. Free-text categories, an importance flag, streaks and quotas.
- **Weight tracking** — manual entries or automatic sync from a Wyze smart scale.
- **Read-only sharing** — expose your calendar and/or to-dos to another account, one-way.
- **Two themes** — light and dark, with everything driven by design tokens.
- **Reminders**, first-day-of-week, ICS import, and an offline-capable Android build.

## Install

Desktop bundles are produced by `bun run tauri build` and land in
`src-tauri/target/release/bundle/` as `.deb`, `.rpm` and `.AppImage`. If you run from a
checkout, `bun run app:desktop` builds and then installs the raw binary to
`~/.local/bin/albas` — point your `.desktop` entry there rather than into
`src-tauri/target/`, so `bun run clean` can wipe build caches without breaking the
launcher.

Android is a signed APK — see [Building](#building) below.

## Developing

```bash
bun install
bun run tauri dev
```

The Hyprland/Wayland WebKit workarounds (`WEBKIT_DISABLE_DMABUF_RENDERER` etc.) are baked
into the `tauri` script, so there is nothing to remember on Linux.

### Which command does what

This trips people up, so it is worth being explicit — **`bun run build` does not build the
app**:

| Command | What it actually does |
|---|---|
| `bun run dev` | Vite only, on `localhost:1420`. No Rust, no SQLite, no sync — persistence falls back to a `localStorage` blob. Fine for pure UI work, misleading for anything else. |
| `bun run tauri dev` | The real desktop app, Rust included. |
| `bun run build` | `tsc && vite build`. The **frontend bundle only**. Does not touch the desktop binary. |
| `bun run tauri build` | Builds `src-tauri/target/release/albas` plus the deb/rpm/AppImage. |
| `bun run app:desktop` | `tauri build`, then installs the binary to `~/.local/bin/albas`. **This** is what updates an installed desktop app. |
| `bun run tauri android dev` | Installs `dev.daniel_p.albas.dev`, whose webview loads the UI from the Vite dev server over the LAN. Useless away from the desk. |
| `bun run app:android` | A standalone signed release APK, **and installs it** to the connected device. `android:install` re-installs the last build without recompiling; `android:launch` starts it. |
| `bun run clean` | Deletes the rebuildable build caches (debug and unused-Android cargo targets, Gradle output, `sync-server/target`) — tens of GB. Keeps `release/` and the aarch64 Android target so the next real build stays fast. |
| `sync-server/scripts/publish.sh` | Builds the sync-server Docker image (amd64), pushes it to GHCR, rebuilds the web console, then SSHes into the server to upload `web/dist/` and pull + restart the stack (expect one passkey prompt). `--build-only` skips the deploy. |

### Building

```bash
# Desktop
bun run app:desktop

# Android: build the signed release APK and install it on the connected device
bun run app:android
```

`tauri android build` on its own only *compiles* — unlike `android dev`, it has no
install step — so `app:android` chains `adb install -r` after it. Same signing key and
applicationId means that's an in-place upgrade: the app's database survives.

Debug Android builds install as a **separate app** (`dev.daniel_p.albas.dev`, launcher name
"albas dev") with their own database, so switching between a dev build and the real app
never costs a wipe. `CLAUDE.md` has the full story on Android identities, signing and a
Tauri quirk where `android dev` installs the suffixed app but launches the unsuffixed one.

### Versioning

**`package.json` is the single source of truth.** Everything else is derived:

```bash
bun run version:set 1.9.0   # rewrites tauri.conf.json, Cargo.toml, Cargo.lock,
                            # and the Android versionName; bumps versionCode
bun run version:check       # fails if they have drifted apart
git tag v1.9.0
```

Never hand-edit `src-tauri/gen/android/app/tauri.properties` — `versionCode` is monotonic and
Android refuses an install whose code is not greater than the installed one.

`sync-server/` is versioned **independently** (`0.2.0`). It is a separately deployed artifact
whose wire protocol is backward-compatible by design, so a server rebuild does not imply an
app release.

## Architecture

```
React + TypeScript + Tailwind v4          src/
        │  Tauri IPC (invoke)
        ▼
Rust: commands, SQLite, sync client        src-tauri/src/
        │  HTTPS, bearer token
        ▼
albas-sync: opaque row store               sync-server/
```

- **The device owns the data.** SQLite is authoritative; the app is fully functional with the
  server switched off or unreachable.
- **The server is a dumb row store.** It holds opaque `(account, table, primary key) → payload`
  rows with a timestamp and a tombstone flag, and never parses a to-do, an event or a weight
  reading — which is why adding a column to the app almost never requires redeploying it.
- **Two clocks, deliberately.** `updated_at` comes from the writing device and decides *who
  wins* (last-write-wins, per row). `seq` is server-assigned and monotonic and decides *what a
  device hasn't seen*. A skewed device clock therefore can never make another device skip a row.

`CLAUDE.md` documents the design rules in detail, including the ones that are load-bearing and
easy to break by accident.

## How it's hosted

The sync server runs in Docker on a home VM, behind nginx with a Let's Encrypt certificate,
at **`albas.danni-dev.com`**. One origin serves everything: the JSON API under `/api`,
Android's Digital Asset Links at the domain root, and the web console at `/`. Images are
published to
`ghcr.io/danielpoprawski/albas-sync` by `sync-server/scripts/publish.sh` (a local amd64
build and push) — so the host needs neither a clone nor a Rust toolchain. A manual-dispatch
GitHub Actions workflow remains for the occasional multi-arch build, should the image ever
need to run on an ARM box or a Pi.

Deploying an update is:

```bash
docker compose pull && docker compose up -d
```

**Back up the `albas-sync-data` volume.** It holds `/data/albas-sync.db`, which is the only
state the server has. Use `sqlite3 .backup` rather than `cp` — the database is in WAL mode
and a raw copy can miss committed data.

**The host is a security boundary, not just an address.** A passkey is bound to a *relying
party ID*, which the server derives from the host in `ALBAS_SYNC_ORIGIN` — and an
authenticator will only release that credential to a page or app proving it speaks for that
host or a parent of it. Albas therefore claims `albas.danni-dev.com` and deliberately **not**
the `danni-dev.com` apex: the apex also carries unrelated services, and an apex RP ID would
make an Albas passkey offerable to all of them. It also means the domain cannot be changed
without invalidating every passkey, and that three files must move together when it is:
`src/syncServer.ts`, `src-tauri/src/sync.rs`, and the Android `asset_statements` string.

Full protocol, account, sharing and deployment docs: [`sync-server/README.md`](sync-server/README.md).

### Why a monorepo, and why the server host has no clone

The app and the server live in one repository. The server already has an independent release
pipeline from inside it (`sync-server/scripts/publish.sh`, versioned by its own
`Cargo.toml`), so splitting buys nothing operationally — while
the sync client's table spec (`src-tauri/src/sync.rs`) and the server's share groups are
co-designed and must agree, which would turn a one-line protocol change into a two-repository
dance.

The machine running the server needs exactly `docker-compose.yml`, a `.env`, and the nginx
configs. Everything else arrives as a published image. A checkout there would be a second
source of truth that silently drifts from what is actually deployed.

## Security and privacy, honestly

- There are **no passwords**. You sign in with a **passkey** — a security key, fingerprint or
  face unlock. The private key never leaves your authenticator; the server stores only the
  public half.
- Each signed-in device gets its own **bearer token**. The token *is* the identity, so it must
  never travel over plain HTTP — hence the TLS reverse proxy being mandatory rather than
  optional.
- **Payloads are stored as plaintext JSON.** "The server never parses your data" is a
  *layering* claim, not a confidentiality one: whoever has root on the host can read every
  event title and task. That is a deliberate, current trade-off — it is what makes an admin
  view possible — and it is worth knowing before putting anything confidential in.
- **Weight data is structurally unshareable.** It appears in no share group, and the sync
  client drops a weights row defensively even if a server sent one.

## Roadmap

- [x] Local-first calendar, to-dos, habits, weights
- [x] Multi-account sync server with passkeys and read-only sharing
- [x] One unified version number across every artifact
- [x] Consolidate onto a single origin serving both the API and the web UI *(client + configs done; DNS pending)*
- [ ] Web admin console — accounts, invites, device tokens, shares
- [ ] Rate limiting and automated backups on the server
- [ ] Encryption at rest, and eventually end-to-end encryption

**On encryption:** end-to-end encryption and an admin console that can read payloads are
mutually exclusive — that is the definition, not an implementation detail. The intended path
is encryption at rest with a server-held key first (which stops a stolen disk or backup
without stopping the console), and a deliberate decision about true E2E later, since it also
breaks read-only sharing and needs a key-recovery story.
