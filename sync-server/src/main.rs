//! Albas sync endpoint.
//!
//! Deliberately knows nothing about todos or events: it is a generic
//! `(account, table, pk) -> payload` store. Every row carries the client's
//! `updated_at` (for last-write-wins) and a server-assigned `seq` (for the pull
//! watermark). Adding a column to the app schema therefore needs no change here.
//!
//! Accounts: each person owns an isolated row set. A bearer token *is* the
//! identity — `/sync` maps it to an account through the `tokens` table (one row
//! per device/login, only SHA-256 hashes stored). Tokens are minted three ways:
//! passkey login/registration (`passkey.rs`), `albas-sync admin account create`
//! (`admin.rs`), and the `ALBAS_SYNC_TOKEN` env var (which owns the `owner` account's
//! `env`-labelled token, rotating with the var as it always did).
//!
//! Sharing: `shares` grants another account read-only access to table groups
//! (`calendar` = events+periods, `todos` = habits+completions+tasks — the
//! server can't split todos from habits because it never parses payloads).
//! `/sync` returns shared rows
//! alongside the account's own; `accounts.grant_rev` is bumped on every grant
//! change so a client can detect that its shared snapshot is stale and rebuild
//! from zero.
//!
//! Why two clocks: `updated_at` comes from whichever device made the edit, so
//! it is only as good as that device's clock — fine for deciding which of two
//! edits wins. `seq` is assigned here, strictly increasing, and is what clients
//! resume from, so a wrong device clock can never make a client skip a row.
//!
//! Administration is a CLI, not HTTP: `albas-sync admin …` (`admin.rs`) opens
//! the same SQLite file and calls the `*_db` functions in this file directly
//! (`create_account_db`, `delete_account_db`, `set_share_db`, …), so there is
//! no admin bearer token and no `/admin/*` route surface to protect. The
//! self-service `/shares` trio is still scoped to whichever account the bearer
//! token identifies; the CLI's `share set <owner> <grantee>` names the pair
//! explicitly instead. Anything the CLI does not cover is a `sqlite3` session
//! against the database (`scripts/admin.sh --sql`).
//!
//! **Invites are not getting further admin support.** The product direction
//! (2026-08) is open signup only — anyone with the site link can create an
//! account — so there is deliberately no invite listing or revoke command.
//! `albas-sync admin invite create` (`passkey::create_invite_db`) still exists
//! for `ALBAS_SYNC_SIGNUPS=invite` deployments and for attaching a passkey to
//! an existing account. See root `CLAUDE.md`, "Project direction".

mod account;
mod admin;
mod app_session;
mod google;
mod lockout;
mod passkey;
mod password;
mod schema;
mod shares;
mod sync;
mod tokens;
mod totp;

use axum::{
    http::HeaderMap,
    routing::{delete, get, post, put},
    Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tower_governor::{
    errors::GovernorError, governor::GovernorConfigBuilder, key_extractor::KeyExtractor,
    GovernorLayer,
};

pub(crate) use schema::init_db;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS accounts (
  id             INTEGER PRIMARY KEY,
  name           TEXT    NOT NULL UNIQUE,
  created_at     INTEGER NOT NULL,
  grant_rev      INTEGER NOT NULL DEFAULT 0,
  -- Argon2id PHC string, or NULL when no password is set. Optional by design:
  -- passkeys remain the primary credential and an account may never gain one.
  password_hash  TEXT,
  -- Base32 TOTP secret, set at enrollment. `totp_confirmed` only flips once a
  -- code generated from it has verified, so a half-finished enrollment can
  -- never lock anyone out.
  totp_secret    TEXT,
  totp_confirmed INTEGER NOT NULL DEFAULT 0,
  -- The verified email address Google last signed this account in as, or
  -- NULL. Not declared UNIQUE: SQLite's `ALTER TABLE ADD COLUMN` (what
  -- `ensure_column` must use for databases that predate this column) cannot
  -- add a UNIQUE constraint, and a fresh database must end up with the same
  -- schema as an upgraded one. `google.rs`'s `find_or_create_account` is the
  -- only writer and enforces uniqueness itself by looking up before it
  -- inserts.
  google_email   TEXT
);
CREATE TABLE IF NOT EXISTS tokens (
  id           INTEGER PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  token_hash   TEXT    NOT NULL UNIQUE,
  label        TEXT    NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  -- Sliding 90-day expiry (see `account_for`). Databases from before these
  -- columns get them from `ensure_token_columns`, backfilled to 0 = expired.
  expires_at   INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS passkeys (
  id           INTEGER PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  cred_id      TEXT    NOT NULL UNIQUE,
  passkey_json TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  -- Admin-set display name, or NULL to derive one from cred_id. Nullable
  -- because `ensure_column` backfills it into older databases and SQLite
  -- cannot ADD COLUMN NOT NULL without a default.
  label        TEXT
);
CREATE TABLE IF NOT EXISTS invites (
  id         INTEGER PRIMARY KEY,
  code_hash  TEXT    NOT NULL UNIQUE,
  name       TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE TABLE IF NOT EXISTS app_sessions (
  -- SHA-256 of the nonce, never the nonce itself: a database read must not
  -- yield something that can be polled for a token.
  nonce_hash TEXT    PRIMARY KEY,
  -- NULL until the browser claims it; that is what 'pending' means.
  account_id INTEGER REFERENCES accounts(id),
  -- The minted app token, held in the clear only between claim and collection.
  token      TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shares (
  owner_id   INTEGER NOT NULL REFERENCES accounts(id),
  grantee_id INTEGER NOT NULL REFERENCES accounts(id),
  calendar   INTEGER NOT NULL DEFAULT 0,
  todos      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, grantee_id)
);
CREATE TABLE IF NOT EXISTS rows (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  tbl        TEXT    NOT NULL,
  pk         TEXT    NOT NULL,
  payload    TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  seq        INTEGER NOT NULL,
  PRIMARY KEY (account_id, tbl, pk)
);
CREATE INDEX IF NOT EXISTS rows_account_seq ON rows(account_id, seq);
-- Per-account brute-force lockout (see lockout.rs). `kind` is 'password' or
-- 'totp' so a lockout on one credential never blocks the other.
CREATE TABLE IF NOT EXISTS auth_failures (
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  kind         TEXT    NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, kind)
);
-- TOTP replay protection: a (account, 30s step) pair that has already
-- verified once can never verify again. Swept in totp.rs as steps age out.
CREATE TABLE IF NOT EXISTS totp_used (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  step       INTEGER NOT NULL,
  PRIMARY KEY (account_id, step)
);
-- One-time TOTP recovery codes, SHA-256 hashed (see totp.rs) — never stored
-- or logged in the clear. `used_at` makes each one single-use.
CREATE TABLE IF NOT EXISTS recovery_codes (
  id         INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  code_hash  TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS recovery_codes_account ON recovery_codes(account_id);
";

/// The account every pre-account database's rows are assigned to, and the one
/// `ALBAS_SYNC_TOKEN` keeps pointing at.
const OWNER: &str = "owner";

/// A bearer token's sliding idle expiry: 90 days from the last time it was
/// used, extended (see `account_for`) rather than fixed from minting, so a
/// device someone actually uses never has to re-authenticate.
const TOKEN_TTL_MS: i64 = 90 * 24 * 60 * 60 * 1000;
/// `account_for` only rewrites `expires_at`/`last_used_at` this often — every
/// authenticated request sliding the watermark would be a write on every
/// `/sync`, for no observable benefit over touching it hourly.
const TOKEN_TOUCH_INTERVAL_MS: i64 = 60 * 60 * 1000;

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Signups {
    Open,
    InviteOnly,
}

pub(crate) struct AppState {
    pub(crate) conn: Mutex<Connection>,
    pub(crate) signups: Signups,
    pub(crate) webauthn: Option<webauthn_rs::Webauthn>,
    pub(crate) assetlinks: Option<String>,
    pub(crate) pending: passkey::Pending,
    pub(crate) google: Option<google::GoogleConfig>,
    pub(crate) google_pending: google::Pending,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Change {
    tbl: String,
    pk: String,
    /// Every non-key, non-bookkeeping column, as a JSON object.
    payload: serde_json::Value,
    updated_at: i64,
    deleted: bool,
    /// Server sequence number, set on rows a pull returns so a client can
    /// resume just before one it could not apply. Ignored on a push (the
    /// server assigns it), and absent from older clients' requests.
    #[serde(default)]
    seq: i64,
}

/// A row belonging to another account that shared it with this one.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SharedChange {
    /// The sharing account's name.
    from: String,
    tbl: String,
    pk: String,
    payload: serde_json::Value,
    updated_at: i64,
    deleted: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncReq {
    /// Highest `seq` this client has already applied. 0 on first sync.
    since: i64,
    changes: Vec<Change>,
    /// Highest `seq` seen among *shared* rows. Defaults keep old clients working.
    #[serde(default)]
    shared_since: i64,
    /// The grant revision the client last saw; a mismatch means its shared
    /// cache may contain revoked rows, so it gets a full snapshot instead.
    #[serde(default)]
    grant_rev: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncRes {
    /// New watermark for the client to store and send as `since` next time.
    seq: i64,
    changes: Vec<Change>,
    shared: Vec<SharedChange>,
    shared_seq: i64,
    grant_rev: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TokenInfo {
    pub(crate) id: i64,
    pub(crate) account_id: i64,
    pub(crate) label: String,
    pub(crate) created_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PasskeyInfo {
    pub(crate) id: i64,
    pub(crate) account_id: i64,
    pub(crate) cred_id: String,
    pub(crate) created_at: i64,
    /// Admin-set name, or `None` when the CLI should derive one from `cred_id`.
    pub(crate) label: Option<String>,
}

/// What `albas-sync admin account list` shows (and, with `--json`, emits
/// verbatim — camelCase because this was the old `GET /accounts` wire shape).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountDetail {
    pub(crate) id: i64,
    pub(crate) name: String,
    pub(crate) created_at: i64,
    pub(crate) grant_rev: i64,
    pub(crate) tokens: Vec<TokenInfo>,
    pub(crate) passkeys: Vec<PasskeyInfo>,
    pub(crate) row_count: i64,
    pub(crate) has_password: bool,
    /// Enrolled *and* confirmed — a half-finished enrollment reads as off,
    /// matching what login actually enforces.
    pub(crate) totp_enabled: bool,
    /// The linked Google address itself, not a bool: the CLI is staff-only
    /// and "which Google account" is what support questions need.
    pub(crate) google_email: Option<String>,
}

fn main() -> std::process::ExitCode {
    // Subcommands run synchronously against the database file and never
    // start the server: `admin` is the operator CLI (see `admin.rs`), `health`
    // is what the container healthcheck calls (the image has no curl). No
    // argument at all means "be the server", which is what `CMD` in the
    // Dockerfile does.
    let mut argv = std::env::args();
    match argv.nth(1).as_deref() {
        None => {}
        Some("admin") => return admin::run(argv),
        Some("health") => return admin::health(),
        Some(other) => {
            eprintln!("albas-sync: unknown argument '{other}'\n\n{USAGE}");
            return std::process::ExitCode::from(2);
        }
    }
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime")
        .block_on(serve());
    std::process::ExitCode::SUCCESS
}

const USAGE: &str = "usage: albas-sync           run the sync server
       albas-sync admin …   operator CLI (`albas-sync admin --help`)
       albas-sync health    exit 0 if the local server answers /health";

/// The `ALBAS_SYNC_DB` path, shared by the server and the admin CLI so both
/// always mean the same file inside the container.
pub(crate) fn db_path() -> String {
    std::env::var("ALBAS_SYNC_DB").unwrap_or_else(|_| "/data/albas-sync.db".into())
}

async fn serve() {
    // `RUST_LOG` filters (default `info`); TraceLayer below logs one line per
    // request. Compact single-line output, since this goes to `docker logs`.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .compact()
        .init();

    let owner_token = env_token("ALBAS_SYNC_TOKEN");
    let db_path = db_path();
    let addr = std::env::var("ALBAS_SYNC_ADDR").unwrap_or_else(|_| "0.0.0.0:8787".into());
    let signups = match std::env::var("ALBAS_SYNC_SIGNUPS").as_deref() {
        Ok("invite") => Signups::InviteOnly,
        Ok("open") | Err(_) => Signups::Open,
        Ok(other) => panic!("ALBAS_SYNC_SIGNUPS must be 'open' or 'invite', not '{other}'"),
    };
    let webauthn = passkey::build_webauthn().expect("failed to configure passkeys");
    let assetlinks = std::env::var("ALBAS_SYNC_ASSETLINKS")
        .ok()
        .filter(|s| !s.trim().is_empty());
    let google = google::GoogleConfig::from_env().expect("failed to configure Google sign-in");

    let mut conn = Connection::open(&db_path).expect("failed to open database");
    conn.pragma_update(None, "journal_mode", "WAL")
        .expect("WAL");
    // The admin CLI, `sqlite3` and Litestream share this file. Wait out a
    // short write lock instead of failing the request with SQLITE_BUSY.
    conn.busy_timeout(Duration::from_secs(5))
        .expect("busy_timeout");
    init_db(&mut conn, owner_token.as_deref()).expect("failed to initialise database");

    let n_accounts: i64 = conn
        .query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0))
        .expect("count accounts");
    if n_accounts == 0 && webauthn.is_none() && owner_token.is_none() {
        panic!(
            "no accounts exist and no way to create one: set ALBAS_SYNC_ORIGIN (to enable \
             passkey signup) or ALBAS_SYNC_TOKEN (which becomes the '{OWNER}' account), or \
             create one from a shell with `albas-sync admin account create <name>`"
        );
    }

    let state = Arc::new(AppState {
        conn: Mutex::new(conn),
        signups,
        webauthn,
        assetlinks,
        pending: passkey::Pending::default(),
        google,
        google_pending: google::Pending::default(),
    });

    // Per-IP rate limiting, applied only to the auth-adjacent routes an
    // unauthenticated caller can hammer: login/register (credential guessing
    // and account-name enumeration), TOTP (code guessing — the per-account
    // lockout in `lockout.rs` is the second, tighter layer under this one),
    // and the Google handoff (ticket guessing). `/sync` and the rest need no
    // IP limit — they already require a valid bearer token, which is the
    // actual scarce resource there.
    //
    // A per-IP limiter allowing one request every `seconds_per_token` seconds
    // sustained, with `burst` in hand. Also starts the sweep that keeps its
    // per-key table from growing by one entry per distinct IP forever. (A
    // closure, not a fn: the config's concrete type is private to the crate.)
    let governor = |seconds_per_token: u64, burst: u32| {
        let conf = Arc::new(
            GovernorConfigBuilder::default()
                .key_extractor(RealIpKeyExtractor)
                .per_second(seconds_per_token)
                .burst_size(burst)
                .finish()
                .expect("valid governor config"),
        );
        let limiter = conf.limiter().clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(300));
            loop {
                tick.tick().await;
                limiter.retain_recent();
            }
        });
        conf
    };
    // 10/min sustained with a burst of 20 — mirrored by nginx's `auth` zone.
    let auth_limit = governor(6, 20);
    // The app-session handoff is polled by design (`useBrowserSignIn` asks
    // every few seconds for up to five minutes), so it gets its own, looser
    // bucket: sharing the auth one let a single pending sign-in drain the
    // budget the browser on the same IP needed for `/login/password`. The
    // nonce is 256 random bits, so the looser limit costs nothing against
    // guessing. Mirrored by nginx's `poll` zone.
    let poll_limit = governor(2, 30);

    let rate_limited = Router::new()
        .route("/register/start", post(passkey::register_start))
        .route("/register/finish", post(passkey::register_finish))
        .route("/register/password", post(password::register_password))
        .route("/login/start", post(passkey::login_start))
        .route("/login/finish", post(passkey::login_finish))
        .route("/login/password", post(password::login_password))
        .route("/totp", get(totp::totp_status).delete(totp::disable_totp))
        .route("/totp/enroll", post(totp::enroll_start))
        .route("/totp/confirm", post(totp::enroll_confirm))
        .route("/auth/google/start", get(google::start))
        .route("/auth/google/callback", get(google::callback))
        .route("/auth/google/session/:ticket", get(google::session))
        .layer(GovernorLayer { config: auth_limit });
    let polled = Router::new()
        .route("/app-session", post(app_session::create))
        .route("/app-session/claim", post(app_session::claim))
        .route("/app-session/:nonce", get(app_session::poll))
        .layer(GovernorLayer { config: poll_limit });

    let app = Router::new()
        .merge(rate_limited)
        .merge(polled)
        // axum's `Json` extractor stops at 2 MB by default. A device's first
        // push after sign-in is its whole history in one request, so match
        // nginx's `client_max_body_size` instead of 413-ing that device forever.
        .layer(axum::extract::DefaultBodyLimit::max(MAX_BODY_BYTES))
        .route("/health", get(|| async { "ok" }))
        .route("/sync", post(sync::sync))
        .route("/shares", get(shares::shares_get))
        .route(
            "/shares/:name",
            put(shares::shares_put).delete(shares::shares_delete),
        )
        .route(
            "/tokens",
            get(tokens::tokens_list).delete(tokens::tokens_delete_others),
        )
        .route("/tokens/current", delete(tokens::tokens_delete_current))
        .route("/tokens/:id", delete(tokens::tokens_delete_one))
        .route("/account", delete(account::self_delete_account))
        .route("/account/export", get(account::account_export))
        .route("/auth/config", get(google::config))
        .route("/passkeys", get(passkey::list_passkeys))
        .route("/passkeys/start", post(passkey::add_passkey_start))
        .route("/passkeys/finish", post(passkey::add_passkey_finish))
        .route(
            "/password",
            get(password::password_status)
                .put(password::set_password)
                .delete(password::clear_password),
        )
        .route("/.well-known/assetlinks.json", get(passkey::assetlinks))
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind");
    tracing::info!(%addr, db = %db_path, "albas-sync listening");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .expect("serve");
}

/// Largest request body accepted, in bytes. Keep equal to
/// `client_max_body_size` in nginx/tls.conf — whichever is smaller wins.
const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;

/// Rate-limit key: the client IP as nginx reports it in `X-Real-IP` (which
/// it *sets*, overwriting anything the client sent — see nginx/tls.conf),
/// falling back to the TCP peer for a bare `cargo run`. Deliberately not
/// tower_governor's `SmartIpKeyExtractor`: that prefers the *first*
/// `X-Forwarded-For` entry, and nginx appends to whatever XFF the client
/// already carried, so a request with a made-up XFF got a fresh bucket every
/// time. The trade-off is that a client talking to the server directly,
/// with no proxy in front, can spoof `X-Real-IP` — the README makes the TLS
/// proxy mandatory for exactly this kind of reason.
#[derive(Clone)]
struct RealIpKeyExtractor;

impl KeyExtractor for RealIpKeyExtractor {
    type Key = std::net::IpAddr;

    fn extract<T>(&self, req: &axum::http::Request<T>) -> Result<Self::Key, GovernorError> {
        req.headers()
            .get("x-real-ip")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse().ok())
            .or_else(|| {
                req.extensions()
                    .get::<axum::extract::ConnectInfo<SocketAddr>>()
                    .map(|c| c.0.ip())
            })
            .ok_or(GovernorError::UnableToExtractKey)
    }
}

/// Reads a token env var, treating empty as unset and refusing weak values.
pub(crate) fn env_token(name: &str) -> Option<String> {
    let v = std::env::var(name).ok()?;
    let v = v.trim().to_string();
    if v.is_empty() {
        return None;
    }
    if v.len() < 16 {
        panic!("{name} is too short; use at least 16 characters");
    }
    Some(v)
}

pub(crate) fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn token_hash(token: &str) -> String {
    to_hex(&Sha256::digest(token.as_bytes()))
}

pub(crate) fn random_token() -> String {
    let mut buf = [0u8; 32];
    getrandom::getrandom(&mut buf).expect("OS randomness unavailable");
    to_hex(&buf)
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Mints a fresh bearer token for an account and stores its hash. Starts with
/// the full 90-day sliding window (see `account_for`, which extends it).
pub(crate) fn mint_token(
    conn: &Connection,
    account_id: i64,
    label: &str,
) -> rusqlite::Result<String> {
    let token = random_token();
    let now = now_ms();
    conn.execute(
        "INSERT INTO tokens (account_id, token_hash, label, created_at, expires_at, last_used_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?4)",
        params![
            account_id,
            token_hash(&token),
            label,
            now,
            now + TOKEN_TTL_MS
        ],
    )?;
    Ok(token)
}

pub(crate) fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

/// Maps a presented token to its account. Lookup is by SHA-256, so response
/// timing reveals nothing useful about any stored credential.
///
/// Also enforces and slides the token's expiry: a token past `expires_at` is
/// treated as absent (401 further up the stack), and one used after its last
/// touch is more than an hour old gets both `expires_at` and `last_used_at`
/// pushed forward — so an idle-but-abandoned token eventually expires, while
/// a device syncing regularly never has to re-authenticate.
pub(crate) fn account_for(conn: &Connection, headers: &HeaderMap) -> Option<i64> {
    let token = bearer(headers)?;
    let hash = token_hash(token);
    let (token_id, account_id, expires_at, last_used_at): (i64, i64, i64, i64) = conn
        .query_row(
            "SELECT id, account_id, expires_at, last_used_at FROM tokens WHERE token_hash = ?1",
            [&hash],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .ok()
        .flatten()?;
    let now = now_ms();
    if expires_at <= now {
        return None;
    }
    if now - last_used_at > TOKEN_TOUCH_INTERVAL_MS {
        // Best-effort: a failed touch must not turn a valid token into a 401.
        let _ = conn.execute(
            "UPDATE tokens SET expires_at = ?1, last_used_at = ?2 WHERE id = ?3",
            params![now + TOKEN_TTL_MS, now, token_id],
        );
    }
    Some(account_id)
}

/// What the admin `*_db` functions fail with. They are called from the CLI
/// (`admin.rs`), which has no HTTP status to map to, so the distinctions the
/// old routes drew — 404 / 409 / 422 / 500 — become variants, with the 409/422
/// reason carried along for the CLI to print.
#[derive(Debug)]
pub(crate) enum AdminError {
    NotFound,
    Conflict(&'static str),
    Invalid(&'static str),
    Db(rusqlite::Error),
}

impl From<rusqlite::Error> for AdminError {
    fn from(e: rusqlite::Error) -> Self {
        AdminError::Db(e)
    }
}

impl std::fmt::Display for AdminError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AdminError::NotFound => f.write_str("not found"),
            AdminError::Conflict(why) | AdminError::Invalid(why) => f.write_str(why),
            AdminError::Db(e) => write!(f, "database error: {e}"),
        }
    }
}

/// SQLite's UNIQUE violation — the one constraint failure the `*_db`
/// functions report as a `Conflict` rather than a `Db` error.
fn is_unique_violation(e: &rusqlite::Error) -> bool {
    matches!(e, rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation)
}

pub(crate) const NAME_RULE: &str = "account names are 1-64 characters: letters, digits, '-' or '_'";

/// Resolves an account name, `NotFound` when there is no such account.
pub(crate) fn account_id(conn: &Connection, name: &str) -> Result<i64, AdminError> {
    conn.query_row("SELECT id FROM accounts WHERE name = ?1", [name], |r| {
        r.get(0)
    })
    .optional()?
    .ok_or(AdminError::NotFound)
}

/// Creates a token-only account and mints its first bearer token, returned in
/// plaintext exactly once — only the hash is stored (`mint_token`).
pub(crate) fn create_account_db(
    conn: &Connection,
    name: &str,
) -> Result<(i64, String), AdminError> {
    let name = name.trim();
    if !name_ok(name) {
        return Err(AdminError::Invalid(NAME_RULE));
    }
    match conn.execute(
        "INSERT INTO accounts (name, created_at) VALUES (?1, ?2)",
        params![name, now_ms()],
    ) {
        Ok(_) => {}
        Err(e) if is_unique_violation(&e) => {
            return Err(AdminError::Conflict(
                "an account with that name already exists",
            ))
        }
        Err(e) => return Err(e.into()),
    }
    let id = conn.last_insert_rowid();
    let token = mint_token(conn, id, "admin")?;
    Ok((id, token))
}

pub(crate) fn name_ok(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Every account with its tokens, passkeys and row count inline. One query
/// per account per sub-list — fine for the handful of accounts this serves.
pub(crate) fn list_accounts_db(conn: &Connection) -> Result<Vec<AccountDetail>, AdminError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, created_at, grant_rev, password_hash IS NOT NULL,
                totp_secret IS NOT NULL AND totp_confirmed = 1, google_email
         FROM accounts ORDER BY created_at",
    )?;
    #[allow(clippy::type_complexity)]
    let accounts: Vec<(i64, String, i64, i64, bool, bool, Option<String>)> = stmt
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut out = Vec::with_capacity(accounts.len());
    for (id, name, created_at, grant_rev, has_password, totp_enabled, google_email) in accounts {
        let tokens = conn
            .prepare("SELECT id, label, created_at FROM tokens WHERE account_id = ?1 ORDER BY created_at")?
            .query_map([id], |r| {
                Ok(TokenInfo { id: r.get(0)?, account_id: id, label: r.get(1)?, created_at: r.get(2)? })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let passkeys = conn
            .prepare("SELECT id, cred_id, created_at, label FROM passkeys WHERE account_id = ?1 ORDER BY created_at")?
            .query_map([id], |r| {
                Ok(PasskeyInfo {
                    id: r.get(0)?,
                    account_id: id,
                    cred_id: r.get(1)?,
                    created_at: r.get(2)?,
                    label: r.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let row_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM rows WHERE account_id = ?1",
            [id],
            |r| r.get(0),
        )?;
        out.push(AccountDetail {
            id,
            name,
            created_at,
            grant_rev,
            tokens,
            passkeys,
            row_count,
            has_password,
            totp_enabled,
            google_email,
        });
    }
    Ok(out)
}

/// Removes the account and everything anchored to it — rows, tokens, passkeys,
/// shares in both directions. Revocation, not archival: the person's devices
/// keep their local copy; the server just forgets it. There are no FK cascades,
/// so the statement order matters: grantees are bumped *before* the shares
/// that identify them are deleted.
pub(crate) fn delete_account_db(conn: &Connection, name: &str) -> Result<(), AdminError> {
    let id = account_id(conn, name)?;
    delete_account_rows(conn, id)?;
    Ok(())
}

/// The one list of everything anchored to an account, shared by the admin
/// CLI and self-service deletion (`account.rs`). Nothing may be left behind:
/// `accounts.id` is a plain INTEGER PRIMARY KEY, so a later account can reuse
/// the number and would inherit any lockout counters, spent TOTP steps,
/// recovery codes or claimed sign-in sessions still keyed on it.
pub(crate) fn delete_account_rows(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let steps = [
        // Whoever was *receiving* shares from this account must rebuild.
        "UPDATE accounts SET grant_rev = grant_rev + 1
         WHERE id IN (SELECT grantee_id FROM shares WHERE owner_id = ?1)",
        "DELETE FROM shares WHERE owner_id = ?1 OR grantee_id = ?1",
        "DELETE FROM rows WHERE account_id = ?1",
        "DELETE FROM tokens WHERE account_id = ?1",
        "DELETE FROM passkeys WHERE account_id = ?1",
        "DELETE FROM auth_failures WHERE account_id = ?1",
        "DELETE FROM totp_used WHERE account_id = ?1",
        "DELETE FROM recovery_codes WHERE account_id = ?1",
        "DELETE FROM app_sessions WHERE account_id = ?1",
        "DELETE FROM accounts WHERE id = ?1",
    ];
    for sql in steps {
        conn.execute(sql, [id])?;
    }
    Ok(())
}

/// The `owner` name is refused in both directions: `upsert_owner` finds that
/// account by name at boot, so renaming it away would leave `ALBAS_SYNC_TOKEN`
/// recreating an empty `owner`, and renaming onto the name would hand the env
/// token's identity to another account.
pub(crate) fn rename_account_db(
    conn: &Connection,
    name: &str,
    new_name: &str,
) -> Result<(), AdminError> {
    let new_name = new_name.trim();
    if !name_ok(new_name) {
        return Err(AdminError::Invalid(NAME_RULE));
    }
    if name == OWNER || new_name == OWNER {
        return Err(AdminError::Conflict(
            "the 'owner' account cannot be renamed to or from",
        ));
    }
    let id = account_id(conn, name)?;
    if new_name == name {
        return Ok(());
    }
    match conn.execute(
        "UPDATE accounts SET name = ?1 WHERE id = ?2",
        params![new_name, id],
    ) {
        Ok(_) => {}
        Err(e) if is_unique_violation(&e) => {
            return Err(AdminError::Conflict(
                "an account with that name already exists",
            ))
        }
        Err(e) => return Err(e.into()),
    }
    // Grantees cache this account's shared rows under ids embedding the old
    // name, so a rename must force their snapshots to rebuild like a
    // revocation would.
    conn.execute(
        "UPDATE accounts SET grant_rev = grant_rev + 1
         WHERE id IN (SELECT grantee_id FROM shares WHERE owner_id = ?1)",
        [id],
    )?;
    Ok(())
}

/// Refuses to delete the last passkey of an account with no password and no
/// Google link: nothing can mint a token for an *existing* account, so that
/// account would be unrecoverable. Deleting the whole account is the escape
/// hatch when that is really meant.
pub(crate) fn delete_passkey_db(
    conn: &Connection,
    name: &str,
    passkey_id: i64,
) -> Result<(), AdminError> {
    let account = account_id(conn, name)?;
    let exists: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM passkeys WHERE id = ?1 AND account_id = ?2",
            params![passkey_id, account],
            |r| r.get(0),
        )
        .optional()?;
    if exists.is_none() {
        return Err(AdminError::NotFound);
    }
    let (passkey_count, other_login): (i64, bool) = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM passkeys WHERE account_id = ?1),
                password_hash IS NOT NULL OR google_email IS NOT NULL
         FROM accounts WHERE id = ?1",
        [account],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if passkey_count == 1 && !other_login {
        return Err(AdminError::Conflict(
            "this is the account's only way in (no password or Google link); delete the account instead",
        ));
    }
    conn.execute(
        "DELETE FROM passkeys WHERE id = ?1 AND account_id = ?2",
        params![passkey_id, account],
    )?;
    Ok(())
}

/// Sets or, with `None`/empty, clears a passkey's admin-facing label — cleared
/// falls back to the name derived from `cred_id`.
pub(crate) fn label_passkey_db(
    conn: &Connection,
    name: &str,
    passkey_id: i64,
    label: Option<&str>,
) -> Result<(), AdminError> {
    let label = label.map(str::trim).filter(|l| !l.is_empty());
    if label.is_some_and(|l| l.len() > 64) {
        return Err(AdminError::Invalid("labels are at most 64 characters"));
    }
    let n = conn.execute(
        "UPDATE passkeys SET label = ?1
         WHERE id = ?2 AND account_id = (SELECT id FROM accounts WHERE name = ?3)",
        params![label, passkey_id, name],
    )?;
    if n == 0 {
        return Err(AdminError::NotFound);
    }
    Ok(())
}

/// Revokes one token — the remote "sign that device out". The device's local
/// data is untouched; its next `/sync` just gets a 401.
pub(crate) fn revoke_token_db(
    conn: &Connection,
    name: &str,
    token_id: i64,
) -> Result<(), AdminError> {
    let n = conn.execute(
        "DELETE FROM tokens WHERE id = ?1 AND account_id = (SELECT id FROM accounts WHERE name = ?2)",
        params![token_id, name],
    )?;
    if n == 0 {
        return Err(AdminError::NotFound);
    }
    Ok(())
}

/// Clearing the only credential would brick the account (see
/// `delete_passkey_db`), so a set password only clears when a passkey or
/// Google link remains. Softer than the self-service guard in `password.rs`,
/// which insists on a passkey specifically: for admin recovery a Google login
/// is as real a way back in.
pub(crate) fn clear_password_db(conn: &Connection, name: &str) -> Result<(), AdminError> {
    let row: Option<(i64, bool, bool)> = conn
        .query_row(
            "SELECT id, password_hash IS NOT NULL,
                    (SELECT COUNT(*) FROM passkeys WHERE account_id = accounts.id) > 0
                      OR google_email IS NOT NULL
             FROM accounts WHERE name = ?1",
            [name],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let Some((id, has_password, other_login)) = row else {
        return Err(AdminError::NotFound);
    };
    if has_password && !other_login {
        return Err(AdminError::Conflict(
            "the password is the account's only credential; a passkey or Google link must remain",
        ));
    }
    conn.execute(
        "UPDATE accounts SET password_hash = NULL WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

/// No guard, deliberately: TOTP is only ever a second factor on password
/// login, so clearing it cannot lock anyone out — it *is* the recovery path
/// for a lost authenticator.
pub(crate) fn clear_totp_db(conn: &Connection, name: &str) -> Result<(), AdminError> {
    let n = conn.execute(
        "UPDATE accounts SET totp_secret = NULL, totp_confirmed = 0 WHERE name = ?1",
        [name],
    )?;
    if n == 0 {
        return Err(AdminError::NotFound);
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminShare {
    pub(crate) owner_id: i64,
    pub(crate) grantee_id: i64,
    pub(crate) owner_name: String,
    pub(crate) grantee_name: String,
    pub(crate) calendar: bool,
    pub(crate) todos: bool,
}

/// Every grant on the server, not just one account's — the CLI has no bearer
/// identity to scope by, which is why this is not a mode of `shares_get`.
pub(crate) fn list_shares_db(conn: &Connection) -> Result<Vec<AdminShare>, AdminError> {
    let mut stmt = conn.prepare(
        "SELECT s.owner_id, s.grantee_id, o.name, g.name, s.calendar, s.todos
         FROM shares s
         JOIN accounts o ON o.id = s.owner_id
         JOIN accounts g ON g.id = s.grantee_id
         ORDER BY o.name, g.name",
    )?;
    let out = stmt
        .query_map([], |r| {
            Ok(AdminShare {
                owner_id: r.get(0)?,
                grantee_id: r.get(1)?,
                owner_name: r.get(2)?,
                grantee_name: r.get(3)?,
                calendar: r.get::<_, i64>(4)? != 0,
                todos: r.get::<_, i64>(5)? != 0,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(out)
}

/// Admin counterpart of `set_share`: the pair is named explicitly (there is no
/// bearer identity to derive an owner from), otherwise the same
/// upsert-or-delete-plus-`grant_rev`-bump rule — both scopes false removes.
pub(crate) fn set_share_db(
    conn: &Connection,
    owner_name: &str,
    grantee_name: &str,
    calendar: bool,
    todos: bool,
) -> Result<(), AdminError> {
    let owner = account_id(conn, owner_name)?;
    let grantee = account_id(conn, grantee_name)?;
    if owner == grantee {
        return Err(AdminError::Invalid("an account cannot share with itself"));
    }
    if !calendar && !todos {
        conn.execute(
            "DELETE FROM shares WHERE owner_id = ?1 AND grantee_id = ?2",
            params![owner, grantee],
        )?;
    } else {
        conn.execute(
            "INSERT INTO shares (owner_id, grantee_id, calendar, todos) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(owner_id, grantee_id) DO UPDATE SET
               calendar = excluded.calendar, todos = excluded.todos",
            params![owner, grantee, calendar as i64, todos as i64],
        )?;
    }
    conn.execute(
        "UPDATE accounts SET grant_rev = grant_rev + 1 WHERE id = ?1",
        [grantee],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests;
