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

mod admin;
mod app_session;
mod google;
mod lockout;
mod passkey;
mod password;
mod totp;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get, post, put},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tower_governor::{governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor, GovernorLayer};

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
  id         INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  token_hash TEXT    NOT NULL UNIQUE,
  label      TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
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

#[derive(Deserialize)]
struct ShareBody {
    calendar: bool,
    todos: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShareInfo {
    name: String,
    calendar: bool,
    todos: bool,
}

#[derive(Serialize)]
struct SharesRes {
    outgoing: Vec<ShareInfo>,
    incoming: Vec<ShareInfo>,
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
    let assetlinks = std::env::var("ALBAS_SYNC_ASSETLINKS").ok().filter(|s| !s.trim().is_empty());
    let google = google::GoogleConfig::from_env().expect("failed to configure Google sign-in");

    let mut conn = Connection::open(&db_path).expect("failed to open database");
    conn.pragma_update(None, "journal_mode", "WAL").expect("WAL");
    // The admin CLI, `sqlite3` and Litestream share this file. Wait out a
    // short write lock instead of failing the request with SQLITE_BUSY.
    conn.busy_timeout(Duration::from_secs(5)).expect("busy_timeout");
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
    // and the app-session/Google handoffs (nonce/ticket guessing). `/sync`
    // and the rest need no IP limit — they already require a valid bearer
    // token, which is the actual scarce resource there.
    //
    // `SmartIpKeyExtractor` reads X-Forwarded-For / X-Real-IP / Forwarded (in
    // that order) and falls back to the TCP peer address — nginx sits in
    // front of every deployment and sets X-Real-IP (see nginx/tls.conf), so
    // this keys on the real client, not the proxy, in production, while still
    // working (via the peer fallback) against a bare `cargo run`.
    let governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .key_extractor(SmartIpKeyExtractor)
            .per_second(6) // 1 token every 6s => 10/min sustained
            .burst_size(20)
            .finish()
            .expect("valid governor config"),
    );
    // governor's per-key state never shrinks on its own; without this a
    // long-running server accumulates one entry per distinct IP forever.
    {
        let limiter = governor_conf.limiter().clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(300));
            loop {
                tick.tick().await;
                limiter.retain_recent();
            }
        });
    }

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
        .route("/app-session", post(app_session::create))
        .route("/app-session/claim", post(app_session::claim))
        .route("/app-session/:nonce", get(app_session::poll))
        .route("/auth/google/start", get(google::start))
        .route("/auth/google/callback", get(google::callback))
        .route("/auth/google/session/:ticket", get(google::session))
        .layer(GovernorLayer { config: governor_conf });

    let app = Router::new()
        .merge(rate_limited)
        .route("/health", get(|| async { "ok" }))
        .route("/sync", post(sync))
        .route("/shares", get(shares_get))
        .route("/shares/:name", put(shares_put).delete(shares_delete))
        .route("/tokens", get(tokens_list).delete(tokens_delete_others))
        .route("/tokens/current", delete(tokens_delete_current))
        .route("/tokens/:id", delete(tokens_delete_one))
        .route("/account", delete(self_delete_account))
        .route("/account/export", get(account_export))
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

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(&format!("SELECT name FROM pragma_table_info('{table}')"))
        .map_err(|e| e.to_string())?;
    let names = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<String>>>()
        .map_err(|e| e.to_string())?;
    Ok(names)
}

/// Adds a column to an existing table if it is missing. `CREATE TABLE IF NOT
/// EXISTS` is a no-op on a database that already has the table, so every column
/// added after a table first shipped needs one of these — the columns are
/// declared in `SCHEMA` for fresh databases and backfilled here for old ones.
/// The definition must carry a default or be nullable; SQLite cannot add a
/// NOT NULL column without one.
fn ensure_column(conn: &Connection, table: &str, column: &str, def: &str) -> Result<(), String> {
    if table_columns(conn, table)?.iter().any(|n| n == column) {
        return Ok(());
    }
    conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {def};"))
        .map_err(|e| e.to_string())
}

/// Creates the schema, upgrading older databases in the same transaction:
///
/// - a pre-account database (`rows` without `account_id`) has its rows rebuilt
///   under the `owner` account with every `seq` preserved, so existing clients'
///   watermarks stay valid;
/// - an early accounts database (`accounts` still carrying `token_hash`) has
///   those credentials moved into the `tokens` table.
///
/// `owner_token`, when set, creates the `owner` account and rotates its
/// `env`-labelled token — how `ALBAS_SYNC_TOKEN` deployments keep working.
pub(crate) fn init_db(conn: &mut Connection, owner_token: Option<&str>) -> Result<(), String> {
    let rows_cols = table_columns(conn, "rows")?;
    let legacy_v1 = !rows_cols.is_empty() && !rows_cols.iter().any(|n| n == "account_id");
    let accounts_cols = table_columns(conn, "accounts")?;
    let legacy_v2 = accounts_cols.iter().any(|n| n == "token_hash");

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if legacy_v1 {
        let token = owner_token.ok_or(
            "this database predates accounts; set ALBAS_SYNC_TOKEN so its rows can be \
             assigned to the 'owner' account",
        )?;
        tx.execute_batch("ALTER TABLE rows RENAME TO rows_v1; DROP INDEX IF EXISTS rows_seq;")
            .map_err(|e| e.to_string())?;
        tx.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        ensure_token_columns(&tx)?;
        let owner_id = upsert_owner(&tx, token).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO rows (account_id, tbl, pk, payload, updated_at, deleted, seq)
             SELECT ?1, tbl, pk, payload, updated_at, deleted, seq FROM rows_v1",
            [owner_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute_batch("DROP TABLE rows_v1;").map_err(|e| e.to_string())?;
    } else if legacy_v2 {
        // token_hash is UNIQUE, which SQLite can't DROP COLUMN away — rebuild
        // the table instead, keeping ids so rows.account_id stays valid.
        tx.execute_batch("ALTER TABLE accounts RENAME TO accounts_v2;")
            .map_err(|e| e.to_string())?;
        tx.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        ensure_token_columns(&tx)?;
        // These are real, currently-working credentials being carried
        // forward by a schema upgrade — not a blank "new column" backfill —
        // so they get the same fresh 90-day expiry a freshly minted token
        // would, rather than reading as already-expired.
        let now = now_ms();
        tx.execute_batch(&format!(
            "INSERT INTO accounts (id, name, created_at)
               SELECT id, name, created_at FROM accounts_v2;
             INSERT INTO tokens (account_id, token_hash, label, created_at, expires_at, last_used_at)
               SELECT id, token_hash, 'migrated', created_at, {}, {now} FROM accounts_v2;
             DROP TABLE accounts_v2;",
            now + TOKEN_TTL_MS,
        ))
        .map_err(|e| e.to_string())?;
        if let Some(token) = owner_token {
            upsert_owner(&tx, token).map_err(|e| e.to_string())?;
        }
    } else {
        tx.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        ensure_token_columns(&tx)?;
        if let Some(token) = owner_token {
            upsert_owner(&tx, token).map_err(|e| e.to_string())?;
        }
    }
    // Columns added to tables after they first shipped. Idempotent, and run
    // on every path above — the two rebuild branches recreate the tables from
    // SCHEMA and so already have them, which is exactly what makes this safe
    // to run unconditionally. (`tokens`' own new columns are handled by
    // `ensure_token_columns` above, earlier in each branch, because
    // `upsert_owner` needs them to already exist.)
    ensure_column(&tx, "accounts", "grant_rev", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(&tx, "accounts", "password_hash", "TEXT")?;
    ensure_column(&tx, "accounts", "totp_secret", "TEXT")?;
    ensure_column(&tx, "accounts", "totp_confirmed", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(&tx, "accounts", "google_email", "TEXT")?;
    ensure_column(&tx, "passkeys", "label", "TEXT")?;
    tx.commit().map_err(|e| e.to_string())
}

/// `tokens.expires_at` / `tokens.last_used_at` must exist before `upsert_owner`
/// runs (it writes both), so unlike the other `ensure_column` calls at the end
/// of `init_db`, these run right after each branch's `SCHEMA` creation.
/// Existing rows backfill to 0 (already-expired), forcing a fresh sign-in
/// rather than a client silently trusting a token this database never
/// recorded an expiry for — acceptable per CLAUDE.md, no migration
/// compatibility is promised beyond `ensure_column` itself.
fn ensure_token_columns(tx: &Connection) -> Result<(), String> {
    ensure_column(tx, "tokens", "expires_at", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(tx, "tokens", "last_used_at", "INTEGER NOT NULL DEFAULT 0")?;
    Ok(())
}

/// Creates the `owner` account if needed, then makes `token` its one
/// `env`-labelled credential — replacing a previous env token, so rotating
/// `ALBAS_SYNC_TOKEN` still rotates that credential without touching tokens
/// minted by passkey logins.
fn upsert_owner(conn: &Connection, token: &str) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO accounts (name, created_at) VALUES (?1, ?2)
         ON CONFLICT(name) DO NOTHING",
        params![OWNER, now_ms()],
    )?;
    let id: i64 =
        conn.query_row("SELECT id FROM accounts WHERE name = ?1", [OWNER], |r| r.get(0))?;
    let h = token_hash(token);
    // A pre-tokens-table migration may have imported this same credential with
    // label 'migrated'; claim it as the env token instead of duplicating it.
    conn.execute(
        "UPDATE tokens SET label = 'env' WHERE account_id = ?1 AND token_hash = ?2",
        params![id, h],
    )?;
    conn.execute(
        "DELETE FROM tokens WHERE account_id = ?1 AND label = 'env' AND token_hash != ?2",
        params![id, h],
    )?;
    let now = now_ms();
    // The env token has no login flow to slide its expiry via `account_for`
    // between server restarts, so every boot (not just first creation) treats
    // itself as a fresh "use" and pushes the expiry another 90 days out.
    conn.execute(
        "INSERT INTO tokens (account_id, token_hash, label, created_at, expires_at, last_used_at)
         VALUES (?1, ?2, 'env', ?3, ?4, ?3)
         ON CONFLICT(token_hash) DO UPDATE SET expires_at = excluded.expires_at, last_used_at = excluded.last_used_at",
        params![id, h, now, now + TOKEN_TTL_MS],
    )?;
    Ok(id)
}

/// Mints a fresh bearer token for an account and stores its hash. Starts with
/// the full 90-day sliding window (see `account_for`, which extends it).
pub(crate) fn mint_token(conn: &Connection, account_id: i64, label: &str) -> rusqlite::Result<String> {
    let token = random_token();
    let now = now_ms();
    conn.execute(
        "INSERT INTO tokens (account_id, token_hash, label, created_at, expires_at, last_used_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?4)",
        params![account_id, token_hash(&token), label, now, now + TOKEN_TTL_MS],
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
    conn.query_row("SELECT id FROM accounts WHERE name = ?1", [name], |r| r.get(0))
        .optional()?
        .ok_or(AdminError::NotFound)
}

/// The tables a grant exposes. Todos and habits live in the same tables, hence
/// one combined group.
fn granted_tables(calendar: bool, todos: bool) -> Vec<&'static str> {
    let mut v = Vec::new();
    if calendar {
        v.extend(["events", "periods", "categories"]);
    }
    if todos {
        v.extend(["habits", "habit_completions", "tasks", "categories"]);
    }
    v
}

async fn sync(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<SyncReq>,
) -> Result<Json<SyncRes>, StatusCode> {
    let mut guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let account_id = account_for(&guard, &headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let tx = guard
        .transaction()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let res = apply_sync(&tx, account_id, &req).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(res))
}

fn apply_sync(tx: &Connection, account_id: i64, req: &SyncReq) -> rusqlite::Result<SyncRes> {
    // Pull *before* applying the push, so the client never receives its own
    // writes back as an echo — they are assigned seqs below this snapshot.
    let changes = {
        let mut stmt = tx.prepare(
            "SELECT tbl, pk, payload, updated_at, deleted FROM rows
             WHERE account_id = ?1 AND seq > ?2 ORDER BY seq",
        )?;
        let rows = stmt.query_map(params![account_id, req.since], |r| {
            Ok(Change {
                tbl: r.get(0)?,
                pk: r.get(1)?,
                payload: serde_json::from_str(&r.get::<_, String>(2)?)
                    .unwrap_or(serde_json::Value::Null),
                updated_at: r.get(3)?,
                deleted: r.get::<_, i64>(4)? != 0,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    // Rows shared *with* this account. A grant-revision mismatch means grants
    // changed since the client's snapshot (rows may have been revoked), so it
    // rebuilds from zero — in which case tombstones are omitted, since the
    // client has nothing they could apply to.
    let my_rev: i64 =
        tx.query_row("SELECT grant_rev FROM accounts WHERE id = ?1", [account_id], |r| r.get(0))?;
    let effective_since = if req.grant_rev == my_rev { req.shared_since } else { 0 };
    let mut shared = Vec::new();
    {
        let mut grants = tx.prepare(
            "SELECT s.owner_id, a.name, s.calendar, s.todos
             FROM shares s JOIN accounts a ON a.id = s.owner_id
             WHERE s.grantee_id = ?1",
        )?;
        let grants = grants
            .query_map([account_id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)? != 0, r.get::<_, i64>(3)? != 0))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (owner_id, owner_name, calendar, todos) in grants {
            let tbls = granted_tables(calendar, todos);
            if tbls.is_empty() {
                continue;
            }
            let tbl_list = tbls.iter().map(|t| format!("'{t}'")).collect::<Vec<_>>().join(", ");
            let skip_tombstones = if effective_since == 0 { " AND deleted = 0" } else { "" };
            let sql = format!(
                "SELECT tbl, pk, payload, updated_at, deleted FROM rows
                 WHERE account_id = ?1 AND seq > ?2 AND tbl IN ({tbl_list}){skip_tombstones}
                 ORDER BY seq"
            );
            let mut stmt = tx.prepare(&sql)?;
            let rows = stmt.query_map(params![owner_id, effective_since], |r| {
                Ok(SharedChange {
                    from: owner_name.clone(),
                    tbl: r.get(0)?,
                    pk: r.get(1)?,
                    payload: serde_json::from_str(&r.get::<_, String>(2)?)
                        .unwrap_or(serde_json::Value::Null),
                    updated_at: r.get(3)?,
                    deleted: r.get::<_, i64>(4)? != 0,
                })
            })?;
            for row in rows {
                shared.push(row?);
            }
        }
    }

    // seq stays globally monotonic across accounts; pulls filter by account,
    // so gaps in one account's sequence are harmless.
    let mut seq: i64 = tx.query_row("SELECT COALESCE(MAX(seq), 0) FROM rows", [], |r| r.get(0))?;

    for c in &req.changes {
        seq += 1;
        // The WHERE on DO UPDATE is the last-write-wins rule: an edit older than
        // what we already hold is dropped, and the wasted seq is harmless.
        tx.execute(
            "INSERT INTO rows (account_id, tbl, pk, payload, updated_at, deleted, seq)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(account_id, tbl, pk) DO UPDATE SET
               payload = excluded.payload,
               updated_at = excluded.updated_at,
               deleted = excluded.deleted,
               seq = excluded.seq
             WHERE excluded.updated_at > rows.updated_at",
            params![
                account_id,
                c.tbl,
                c.pk,
                c.payload.to_string(),
                c.updated_at,
                c.deleted as i64,
                seq
            ],
        )?;
    }

    let watermark: i64 =
        tx.query_row("SELECT COALESCE(MAX(seq), 0) FROM rows", [], |r| r.get(0))?;
    // The shared snapshot was taken in this same transaction, so the one
    // watermark covers both streams: any later shared write gets a higher seq.
    Ok(SyncRes {
        seq: watermark,
        changes,
        shared,
        shared_seq: watermark,
        grant_rev: my_rev,
    })
}

/// Creates a token-only account and mints its first bearer token, returned in
/// plaintext exactly once — only the hash is stored (`mint_token`).
pub(crate) fn create_account_db(conn: &Connection, name: &str) -> Result<(i64, String), AdminError> {
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
            return Err(AdminError::Conflict("an account with that name already exists"))
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
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
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
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
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
        let row_count: i64 =
            conn.query_row("SELECT COUNT(*) FROM rows WHERE account_id = ?1", [id], |r| r.get(0))?;
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
    let steps = [
        // Whoever was *receiving* shares from this account must rebuild.
        "UPDATE accounts SET grant_rev = grant_rev + 1
         WHERE id IN (SELECT grantee_id FROM shares WHERE owner_id = ?1)",
        "DELETE FROM shares WHERE owner_id = ?1 OR grantee_id = ?1",
        "DELETE FROM rows WHERE account_id = ?1",
        "DELETE FROM tokens WHERE account_id = ?1",
        "DELETE FROM passkeys WHERE account_id = ?1",
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
pub(crate) fn rename_account_db(conn: &Connection, name: &str, new_name: &str) -> Result<(), AdminError> {
    let new_name = new_name.trim();
    if !name_ok(new_name) {
        return Err(AdminError::Invalid(NAME_RULE));
    }
    if name == OWNER || new_name == OWNER {
        return Err(AdminError::Conflict("the 'owner' account cannot be renamed to or from"));
    }
    let id = account_id(conn, name)?;
    if new_name == name {
        return Ok(());
    }
    match conn.execute("UPDATE accounts SET name = ?1 WHERE id = ?2", params![new_name, id]) {
        Ok(_) => {}
        Err(e) if is_unique_violation(&e) => {
            return Err(AdminError::Conflict("an account with that name already exists"))
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
pub(crate) fn delete_passkey_db(conn: &Connection, name: &str, passkey_id: i64) -> Result<(), AdminError> {
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
pub(crate) fn revoke_token_db(conn: &Connection, name: &str, token_id: i64) -> Result<(), AdminError> {
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
    conn.execute("UPDATE accounts SET password_hash = NULL WHERE id = ?1", [id])?;
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

async fn shares_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<SharesRes>, StatusCode> {
    let guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let me = account_for(&guard, &headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let list = |sql: &str| -> Result<Vec<ShareInfo>, StatusCode> {
        let mut stmt = guard.prepare(sql).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        stmt.query_map([me], |r| {
            Ok(ShareInfo {
                name: r.get(0)?,
                calendar: r.get::<_, i64>(1)? != 0,
                todos: r.get::<_, i64>(2)? != 0,
            })
        })
        .and_then(|rows| rows.collect())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
    };
    let outgoing = list(
        "SELECT a.name, s.calendar, s.todos FROM shares s
         JOIN accounts a ON a.id = s.grantee_id WHERE s.owner_id = ?1 ORDER BY a.name",
    )?;
    let incoming = list(
        "SELECT a.name, s.calendar, s.todos FROM shares s
         JOIN accounts a ON a.id = s.owner_id WHERE s.grantee_id = ?1 ORDER BY a.name",
    )?;
    Ok(Json(SharesRes { outgoing, incoming }))
}

async fn shares_put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(body): Json<ShareBody>,
) -> Result<Json<Value>, StatusCode> {
    set_share(&state, &headers, &name, body.calendar, body.todos)
}

async fn shares_delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Result<Json<Value>, StatusCode> {
    set_share(&state, &headers, &name, false, false)
}

/// `{"ok": true}` on success, `{"ok": false}` (still 200, not 404) for an
/// unknown grantee name — a 404 here would let anyone probe which account
/// names exist on the server just by trying to share with them.
fn set_share(
    state: &AppState,
    headers: &HeaderMap,
    grantee_name: &str,
    calendar: bool,
    todos: bool,
) -> Result<Json<Value>, StatusCode> {
    let mut guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let me = account_for(&guard, headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let tx = guard
        .transaction()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let grantee: Option<i64> = tx
        .query_row("SELECT id FROM accounts WHERE name = ?1", [grantee_name], |r| r.get(0))
        .optional()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let Some(grantee) = grantee else {
        return Ok(Json(json!({ "ok": false })));
    };
    if grantee == me {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    if !calendar && !todos {
        tx.execute(
            "DELETE FROM shares WHERE owner_id = ?1 AND grantee_id = ?2",
            params![me, grantee],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else {
        tx.execute(
            "INSERT INTO shares (owner_id, grantee_id, calendar, todos) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(owner_id, grantee_id) DO UPDATE SET
               calendar = excluded.calendar, todos = excluded.todos",
            params![me, grantee, calendar as i64, todos as i64],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    // Any grant change invalidates the grantee's shared snapshot.
    tx.execute("UPDATE accounts SET grant_rev = grant_rev + 1 WHERE id = ?1", [grantee])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(json!({ "ok": true })))
}

// --- Self-service tokens (Settings -> Sessions) ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SelfTokenInfo {
    id: i64,
    label: String,
    created_at: i64,
    expires_at: i64,
    last_used_at: i64,
    /// Whether this is the token the request itself was authenticated with —
    /// so the client can label "this device" and warn before revoking it.
    current: bool,
}

async fn tokens_list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<SelfTokenInfo>>, StatusCode> {
    let guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let account_id = account_for(&guard, &headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let current_hash = bearer(&headers).map(token_hash).unwrap_or_default();
    let mut stmt = guard
        .prepare(
            "SELECT id, label, created_at, expires_at, last_used_at, token_hash
             FROM tokens WHERE account_id = ?1 ORDER BY created_at",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let out = stmt
        .query_map([account_id], |r| {
            let hash: String = r.get(5)?;
            Ok(SelfTokenInfo {
                id: r.get(0)?,
                label: r.get(1)?,
                created_at: r.get(2)?,
                expires_at: r.get(3)?,
                last_used_at: r.get(4)?,
                current: hash == current_hash,
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(out))
}

/// Revokes the token this very request is authenticated with — "sign out this
/// device", the alias `sync_sign_out` calls best-effort before clearing local
/// state. `id` is deliberately not accepted here; `DELETE /tokens/:id` covers
/// that, and would let a caller mistype an id and be told nothing changed.
async fn tokens_delete_current(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<StatusCode, StatusCode> {
    let guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let token = bearer(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let n = guard
        .execute("DELETE FROM tokens WHERE token_hash = ?1", [token_hash(token)])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if n == 0 {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Revokes one other session by id — scoped to the caller's own account, so
/// naming another account's token id 404s exactly like an unknown one.
async fn tokens_delete_one(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    let guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let account_id = account_for(&guard, &headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let n = guard
        .execute(
            "DELETE FROM tokens WHERE id = ?1 AND account_id = ?2",
            params![id, account_id],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if n == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// "Sign out everywhere else" — every token on the account except the one
/// this request used.
async fn tokens_delete_others(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<StatusCode, StatusCode> {
    let guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let account_id = account_for(&guard, &headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let token = bearer(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    guard
        .execute(
            "DELETE FROM tokens WHERE account_id = ?1 AND token_hash != ?2",
            params![account_id, token_hash(token)],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

// --- Self-service account deletion and export ---

#[derive(Deserialize)]
struct DeleteAccountReq {
    password: String,
}

/// The self-service counterpart of the admin `delete_account`: same steps,
/// but authenticated by bearer token + a re-typed password rather than the
/// admin token, and always scoped to the caller's own account.
async fn self_delete_account(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<DeleteAccountReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    let mut guard = state
        .conn
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let account_id = account_for(&guard, &headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Unauthorized".into()))?;
    password::verify_account_password(&guard, account_id, &body.password)?;
    let tx = guard
        .transaction()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let steps = [
        "UPDATE accounts SET grant_rev = grant_rev + 1
         WHERE id IN (SELECT grantee_id FROM shares WHERE owner_id = ?1)",
        "DELETE FROM shares WHERE owner_id = ?1 OR grantee_id = ?1",
        "DELETE FROM rows WHERE account_id = ?1",
        "DELETE FROM tokens WHERE account_id = ?1",
        "DELETE FROM passkeys WHERE account_id = ?1",
        "DELETE FROM auth_failures WHERE account_id = ?1",
        "DELETE FROM totp_used WHERE account_id = ?1",
        "DELETE FROM recovery_codes WHERE account_id = ?1",
        "DELETE FROM accounts WHERE id = ?1",
    ];
    for sql in steps {
        tx.execute(sql, [account_id])
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    tx.commit().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

/// Every non-deleted row this account owns, as JSON — the "download your
/// data" self-service export. Payloads included, on purpose: this is the
/// account owner asking for their own data back, not an operator browsing
/// bookkeeping columns.
async fn account_export(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let account_id = account_for(&guard, &headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let (name, created_at): (String, i64) = guard
        .query_row(
            "SELECT name, created_at FROM accounts WHERE id = ?1",
            [account_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut stmt = guard
        .prepare(
            "SELECT tbl, pk, payload, updated_at, deleted FROM rows
             WHERE account_id = ?1 AND deleted = 0 ORDER BY tbl, pk",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = stmt
        .query_map([account_id], |r| {
            Ok(Change {
                tbl: r.get(0)?,
                pk: r.get(1)?,
                payload: serde_json::from_str(&r.get::<_, String>(2)?)
                    .unwrap_or(serde_json::Value::Null),
                updated_at: r.get(3)?,
                deleted: r.get::<_, i64>(4)? != 0,
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(json!({
        "account": { "name": name, "createdAt": created_at },
        "rows": rows,
    })))
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
    conn.execute("UPDATE accounts SET grant_rev = grant_rev + 1 WHERE id = ?1", [grantee])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem(owner_token: Option<&str>) -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        init_db(&mut c, owner_token).unwrap();
        c
    }

    fn make_account(c: &Connection, name: &str) -> i64 {
        c.execute(
            "INSERT INTO accounts (name, created_at) VALUES (?1, 0)",
            params![name],
        )
        .unwrap();
        c.last_insert_rowid()
    }

    fn auth_headers(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", format!("Bearer {token}").parse().unwrap());
        headers
    }

    fn change(tbl: &str, pk: &str, payload: &str, updated_at: i64) -> Change {
        Change {
            tbl: tbl.into(),
            pk: pk.into(),
            payload: serde_json::from_str(payload).unwrap(),
            updated_at,
            deleted: false,
        }
    }

    fn req(changes: Vec<Change>) -> SyncReq {
        SyncReq { since: 0, changes, shared_since: 0, grant_rev: 0 }
    }

    fn grant(c: &Connection, owner: i64, grantee: i64, calendar: bool, todos: bool) {
        c.execute(
            "INSERT INTO shares (owner_id, grantee_id, calendar, todos) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(owner_id, grantee_id) DO UPDATE SET
               calendar = excluded.calendar, todos = excluded.todos",
            params![owner, grantee, calendar as i64, todos as i64],
        )
        .unwrap();
        c.execute("UPDATE accounts SET grant_rev = grant_rev + 1 WHERE id = ?1", [grantee])
            .unwrap();
    }

    fn make_passkey(c: &Connection, account: i64, cred: &str) -> i64 {
        c.execute(
            "INSERT INTO passkeys (account_id, cred_id, passkey_json, created_at)
             VALUES (?1, ?2, '{}', 0)",
            params![account, cred],
        )
        .unwrap();
        c.last_insert_rowid()
    }

    fn grant_rev(c: &Connection, id: i64) -> i64 {
        c.query_row("SELECT grant_rev FROM accounts WHERE id = ?1", [id], |r| r.get(0)).unwrap()
    }

    #[test]
    fn rename_validates_and_bumps_grantees() {
        let c = mem(None);
        let alice = make_account(&c, "alice");
        let bob = make_account(&c, "bob");
        make_account(&c, "carol");
        grant(&c, alice, bob, true, false);
        let rev = grant_rev(&c, bob);

        assert!(matches!(rename_account_db(&c, "alice", "bad name!"), Err(AdminError::Invalid(_))));
        assert!(matches!(rename_account_db(&c, "missing", "fine"), Err(AdminError::NotFound)));
        assert!(matches!(rename_account_db(&c, "alice", "carol"), Err(AdminError::Conflict(_))));
        assert!(matches!(rename_account_db(&c, "owner", "boss"), Err(AdminError::Conflict(_))));
        assert!(matches!(rename_account_db(&c, "alice", OWNER), Err(AdminError::Conflict(_))));
        assert_eq!(grant_rev(&c, bob), rev, "failed renames must not bump grantees");

        rename_account_db(&c, "alice", "alicia").unwrap();
        let name: String = c
            .query_row("SELECT name FROM accounts WHERE id = ?1", [alice], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "alicia");
        // Bob caches alice's shared rows under her old name; his snapshot must
        // be invalidated exactly as a revocation would.
        assert_eq!(grant_rev(&c, bob), rev + 1);
    }

    #[test]
    fn deleting_last_passkey_needs_another_login_method() {
        let c = mem(None);
        let a = make_account(&c, "a");
        let only = make_passkey(&c, a, "cred1");

        assert!(matches!(delete_passkey_db(&c, "missing", only), Err(AdminError::NotFound)));
        assert!(matches!(delete_passkey_db(&c, "a", 999), Err(AdminError::NotFound)));
        assert!(matches!(delete_passkey_db(&c, "a", only), Err(AdminError::Conflict(_))));

        let second = make_passkey(&c, a, "cred2");
        assert!(delete_passkey_db(&c, "a", second).is_ok(), "not the last one");
        assert!(matches!(delete_passkey_db(&c, "a", only), Err(AdminError::Conflict(_))));

        c.execute("UPDATE accounts SET password_hash = 'x' WHERE id = ?1", [a]).unwrap();
        assert!(delete_passkey_db(&c, "a", only).is_ok(), "password remains as a way in");

        let b = make_account(&c, "b");
        let bs = make_passkey(&c, b, "cred3");
        c.execute("UPDATE accounts SET google_email = 'b@example.com' WHERE id = ?1", [b])
            .unwrap();
        assert!(delete_passkey_db(&c, "b", bs).is_ok(), "google link counts too");
    }

    #[test]
    fn passkey_delete_is_scoped_to_the_named_account() {
        let c = mem(None);
        let a = make_account(&c, "a");
        make_account(&c, "b");
        make_passkey(&c, a, "cred1");
        let target = make_passkey(&c, a, "cred2");
        assert!(matches!(delete_passkey_db(&c, "b", target), Err(AdminError::NotFound)));
        let still: i64 =
            c.query_row("SELECT COUNT(*) FROM passkeys WHERE id = ?1", [target], |r| r.get(0))
                .unwrap();
        assert_eq!(still, 1);
    }

    #[test]
    fn clear_password_needs_another_login_method() {
        let c = mem(None);
        let a = make_account(&c, "a");

        assert!(matches!(clear_password_db(&c, "missing"), Err(AdminError::NotFound)));
        assert!(clear_password_db(&c, "a").is_ok(), "no password set: idempotent no-op");

        c.execute("UPDATE accounts SET password_hash = 'x' WHERE id = ?1", [a]).unwrap();
        assert!(matches!(clear_password_db(&c, "a"), Err(AdminError::Conflict(_))), "only credential");

        make_passkey(&c, a, "cred1");
        clear_password_db(&c, "a").unwrap();
        let has: bool = c
            .query_row("SELECT password_hash IS NOT NULL FROM accounts WHERE id = ?1", [a], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(!has);
    }

    /// The core merge rule: a stale edit must not clobber a newer one, in
    /// either arrival order.
    #[test]
    fn last_write_wins_regardless_of_arrival_order() {
        let mut c = mem(None);
        let acct = make_account(&c, "a");
        let tx = c.transaction().unwrap();

        let push = |r: &SyncReq| apply_sync(&tx, acct, r).unwrap();
        push(&req(vec![change("habits", "a", "{\"name\":\"new\"}", 200)]));
        push(&req(vec![change("habits", "a", "{\"name\":\"old\"}", 100)]));
        let got: String = tx
            .query_row("SELECT payload FROM rows WHERE pk = 'a'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(got, "{\"name\":\"new\"}", "older edit must not overwrite newer");

        push(&req(vec![change("habits", "b", "{\"name\":\"old\"}", 100)]));
        push(&req(vec![change("habits", "b", "{\"name\":\"new\"}", 200)]));
        let got: String = tx
            .query_row("SELECT payload FROM rows WHERE pk = 'b'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(got, "{\"name\":\"new\"}", "newer edit must overwrite older");
    }

    /// A rejected write must not advance the row's seq, or clients would pull
    /// a row whose contents did not change.
    #[test]
    fn rejected_write_leaves_seq_alone() {
        let mut c = mem(None);
        let acct = make_account(&c, "a");
        let tx = c.transaction().unwrap();
        apply_sync(&tx, acct, &req(vec![change("events", "e", "{}", 500)])).unwrap();
        let seq_before: i64 = tx
            .query_row("SELECT seq FROM rows WHERE pk = 'e'", [], |r| r.get(0))
            .unwrap();
        apply_sync(&tx, acct, &req(vec![change("events", "e", "{}", 400)])).unwrap();
        let seq_after: i64 = tx
            .query_row("SELECT seq FROM rows WHERE pk = 'e'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(seq_before, seq_after);
    }

    /// The point of accounts: two people on one server, same table and pk,
    /// and neither ever pulls the other's rows as their own.
    #[test]
    fn accounts_are_isolated_from_each_other() {
        let mut c = mem(None);
        let alice = make_account(&c, "alice");
        let bob = make_account(&c, "bob");
        let tx = c.transaction().unwrap();

        apply_sync(&tx, alice, &req(vec![change("habits", "h1", "{\"name\":\"run\"}", 100)]))
            .unwrap();
        apply_sync(&tx, bob, &req(vec![change("habits", "h1", "{\"name\":\"read\"}", 100)]))
            .unwrap();

        let alice_pull = apply_sync(&tx, alice, &req(vec![])).unwrap();
        assert_eq!(alice_pull.changes.len(), 1);
        assert_eq!(alice_pull.changes[0].payload["name"], "run");
        assert!(alice_pull.shared.is_empty());

        let bob_pull = apply_sync(&tx, bob, &req(vec![])).unwrap();
        assert_eq!(bob_pull.changes.len(), 1);
        assert_eq!(bob_pull.changes[0].payload["name"], "read");
        assert!(bob_pull.shared.is_empty());
    }

    /// Multiple tokens resolve to the same account, and revoking one leaves
    /// the others working — the per-device credential model.
    #[test]
    fn token_auth_via_tokens_table() {
        let c = mem(None);
        let alice = make_account(&c, "alice");
        let t1 = mint_token(&c, alice, "laptop").unwrap();
        let t2 = mint_token(&c, alice, "phone").unwrap();

        assert_eq!(account_for(&c, &auth_headers(&t1)), Some(alice));
        assert_eq!(account_for(&c, &auth_headers(&t2)), Some(alice));
        assert_eq!(account_for(&c, &auth_headers("wrong-token-000000")), None);

        c.execute("DELETE FROM tokens WHERE token_hash = ?1", [token_hash(&t1)]).unwrap();
        assert_eq!(account_for(&c, &auth_headers(&t1)), None);
        assert_eq!(account_for(&c, &auth_headers(&t2)), Some(alice));
    }

    /// `ALBAS_SYNC_TOKEN` keeps working: it creates the owner account on a
    /// fresh database and re-keys the env credential when the value changes,
    /// without touching tokens minted elsewhere (passkey logins).
    #[test]
    fn owner_token_bootstraps_and_rotates() {
        let mut c = mem(Some("first-owner-token-x"));
        let owner: i64 = c
            .query_row("SELECT account_id FROM tokens WHERE token_hash = ?1",
                [token_hash("first-owner-token-x")], |r| r.get(0))
            .unwrap();
        let device = mint_token(&c, owner, "passkey").unwrap();

        init_db(&mut c, Some("second-owner-token-x")).unwrap();
        let owner2: i64 = c
            .query_row("SELECT account_id FROM tokens WHERE token_hash = ?1",
                [token_hash("second-owner-token-x")], |r| r.get(0))
            .unwrap();
        assert_eq!(owner, owner2, "rotation must re-key the same account");
        let old_env: Option<i64> = c
            .query_row("SELECT id FROM tokens WHERE token_hash = ?1",
                [token_hash("first-owner-token-x")], |r| r.get(0))
            .optional()
            .unwrap();
        assert!(old_env.is_none(), "the previous env token must be revoked");
        assert_eq!(
            account_for(&c, &auth_headers(&device)),
            Some(owner),
            "device tokens must survive env rotation"
        );
        let n: i64 = c.query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    /// A pre-account database is migrated in place: rows land under `owner`
    /// with their seq preserved, so existing clients' watermarks stay valid.
    #[test]
    fn legacy_v1_database_migrates_rows_to_owner() {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE rows (
               tbl TEXT NOT NULL, pk TEXT NOT NULL, payload TEXT NOT NULL,
               updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
               seq INTEGER NOT NULL, PRIMARY KEY (tbl, pk));
             CREATE INDEX rows_seq ON rows(seq);
             INSERT INTO rows VALUES ('habits', 'h1', '{\"name\":\"run\"}', 100, 0, 7);
             INSERT INTO rows VALUES ('tasks', 't1', '{\"title\":\"milk\"}', 200, 1, 8);",
        )
        .unwrap();

        assert!(
            init_db(&mut c, None).is_err(),
            "migration without ALBAS_SYNC_TOKEN must fail loudly, not orphan rows"
        );
        init_db(&mut c, Some("legacy-owner-token-x")).unwrap();

        let owner_id: i64 = c
            .query_row("SELECT id FROM accounts WHERE name = 'owner'", [], |r| r.get(0))
            .unwrap();
        let rows: Vec<(i64, String, i64)> = c
            .prepare("SELECT account_id, pk, seq FROM rows ORDER BY seq")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(rows, vec![(owner_id, "h1".into(), 7), (owner_id, "t1".into(), 8)]);
        assert_eq!(account_for(&c, &auth_headers("legacy-owner-token-x")), Some(owner_id));

        // And a second startup is a no-op, not a second migration.
        init_db(&mut c, Some("legacy-owner-token-x")).unwrap();
        let n: i64 = c.query_row("SELECT COUNT(*) FROM rows", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
    }

    /// The short-lived accounts schema that still kept `token_hash` on the
    /// accounts table migrates its credentials into `tokens`.
    #[test]
    fn legacy_v2_accounts_schema_migrates_tokens_out() {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch(&format!(
            "CREATE TABLE accounts (
               id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
               token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
             CREATE TABLE rows (
               account_id INTEGER NOT NULL, tbl TEXT NOT NULL, pk TEXT NOT NULL,
               payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
               deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
               PRIMARY KEY (account_id, tbl, pk));
             CREATE INDEX rows_account_seq ON rows(account_id, seq);
             INSERT INTO accounts VALUES (1, 'owner', '{}', 10);
             INSERT INTO accounts VALUES (2, 'sarah', '{}', 20);
             INSERT INTO rows VALUES (2, 'habits', 'h1', '{{}}', 100, 0, 3);",
            token_hash("owner-env-token-xx"),
            token_hash("sarah-token-yyyyyy"),
        ))
        .unwrap();

        init_db(&mut c, Some("owner-env-token-xx")).unwrap();

        assert_eq!(account_for(&c, &auth_headers("owner-env-token-xx")), Some(1));
        assert_eq!(account_for(&c, &auth_headers("sarah-token-yyyyyy")), Some(2));
        let cols = table_columns(&c, "accounts").unwrap();
        assert!(!cols.iter().any(|n| n == "token_hash"));
        assert!(cols.iter().any(|n| n == "grant_rev"));
        // The owner's imported credential was claimed as the env token, not doubled.
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM tokens WHERE account_id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let label: String = c
            .query_row("SELECT label FROM tokens WHERE account_id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(label, "env");
        // Rows survived untouched.
        let seq: i64 = c.query_row("SELECT seq FROM rows WHERE pk = 'h1'", [], |r| r.get(0)).unwrap();
        assert_eq!(seq, 3);
    }

    /// Sharing exposes exactly the granted table groups, to exactly the
    /// grantee — never a table outside a group, never a third account.
    #[test]
    fn share_filtering_and_isolation() {
        let mut c = mem(None);
        let alice = make_account(&c, "alice");
        let bob = make_account(&c, "bob");
        let carol = make_account(&c, "carol");
        grant(&c, alice, bob, true, false); // calendar only
        let tx = c.transaction().unwrap();

        apply_sync(
            &tx,
            alice,
            &req(vec![
                change("events", "e1", "{\"title\":\"dinner\"}", 100),
                change("periods", "p1", "{\"name\":\"trip\"}", 100),
                change("habits", "h1", "{\"name\":\"run\"}", 100),
                change("scratch", "s1", "{\"n\":1}", 100),
            ]),
        )
        .unwrap();

        let bob_pull = apply_sync(&tx, bob, &SyncReq { since: 0, changes: vec![], shared_since: 0, grant_rev: 1 })
            .unwrap();
        let tbls: Vec<&str> = bob_pull.shared.iter().map(|s| s.tbl.as_str()).collect();
        assert!(tbls.contains(&"events") && tbls.contains(&"periods"));
        assert!(!tbls.contains(&"habits"), "todos group was not granted");
        assert!(!tbls.contains(&"scratch"), "a table outside every group is never shareable");
        assert!(bob_pull.shared.iter().all(|s| s.from == "alice"));
        assert!(bob_pull.changes.is_empty(), "shared rows must not appear as own rows");

        let carol_pull = apply_sync(&tx, carol, &req(vec![])).unwrap();
        assert!(carol_pull.shared.is_empty(), "no grant, no data");
    }

    /// A grant-revision mismatch yields a full tombstone-free snapshot and the
    /// new revision; a matching revision yields an incremental pull that does
    /// carry tombstones.
    #[test]
    fn grant_rev_mismatch_sends_full_snapshot() {
        let mut c = mem(None);
        let alice = make_account(&c, "alice");
        let bob = make_account(&c, "bob");
        grant(&c, alice, bob, true, false);
        let tx = c.transaction().unwrap();

        apply_sync(
            &tx,
            alice,
            &req(vec![
                change("events", "e1", "{\"title\":\"kept\"}", 100),
                Change { deleted: true, ..change("events", "e2", "{\"title\":\"gone\"}", 100) },
            ]),
        )
        .unwrap();

        // Stale rev (0 ≠ 1): full snapshot, tombstone omitted.
        let stale = apply_sync(&tx, bob, &SyncReq { since: 0, changes: vec![], shared_since: 999, grant_rev: 0 })
            .unwrap();
        assert_eq!(stale.grant_rev, 1);
        assert_eq!(stale.shared.len(), 1, "sharedSince is ignored on mismatch; tombstones dropped");
        assert_eq!(stale.shared[0].pk, "e1");

        // Matching rev: incremental from sharedSince, tombstones included.
        let shared_since = stale.shared_seq;
        apply_sync(
            &tx,
            alice,
            &req(vec![Change { deleted: true, ..change("events", "e1", "{}", 200) }]),
        )
        .unwrap();
        let incr = apply_sync(
            &tx,
            bob,
            &SyncReq { since: 0, changes: vec![], shared_since, grant_rev: 1 },
        )
        .unwrap();
        assert_eq!(incr.shared.len(), 1);
        assert!(incr.shared[0].deleted, "incremental pulls must carry tombstones");
    }

    /// Changing or revoking a grant bumps the grantee's revision so their next
    /// sync rebuilds the shared cache.
    #[test]
    fn share_changes_bump_grantee_rev() {
        let c = mem(None);
        let alice = make_account(&c, "alice");
        let bob = make_account(&c, "bob");
        let rev = |id: i64| -> i64 {
            c.query_row("SELECT grant_rev FROM accounts WHERE id = ?1", [id], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(rev(bob), 0);
        grant(&c, alice, bob, true, true);
        assert_eq!(rev(bob), 1);
        grant(&c, alice, bob, true, false);
        assert_eq!(rev(bob), 2);
        assert_eq!(rev(alice), 0, "the owner's own rev is untouched");
    }

    #[test]
    fn create_account_mints_a_token_whose_hash_is_stored() {
        let c = mem(None);
        let (id, token) = create_account_db(&c, " alice ").unwrap();
        let name: String =
            c.query_row("SELECT name FROM accounts WHERE id = ?1", [id], |r| r.get(0)).unwrap();
        assert_eq!(name, "alice", "trimmed");
        let (stored, label): (String, String) = c
            .query_row("SELECT token_hash, label FROM tokens WHERE account_id = ?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(stored, token_hash(&token));
        assert_eq!(label, "admin");
        assert_eq!(account_for(&c, &auth_headers(&token)), Some(id), "the printed token signs in");

        assert!(matches!(create_account_db(&c, "alice"), Err(AdminError::Conflict(_))));
        assert!(matches!(create_account_db(&c, "bad name!"), Err(AdminError::Invalid(_))));
        assert!(matches!(create_account_db(&c, ""), Err(AdminError::Invalid(_))));
    }

    /// Everything anchored to the account goes, grantees are bumped (before
    /// the shares that identify them are deleted), and accounts that shared
    /// *to* it are left alone.
    #[test]
    fn delete_account_cascades_and_bumps_grantees() {
        let c = mem(None);
        let alice = make_account(&c, "alice");
        let bob = make_account(&c, "bob");
        let carol = make_account(&c, "carol");
        mint_token(&c, alice, "laptop").unwrap();
        make_passkey(&c, alice, "cred1");
        c.execute(
            "INSERT INTO rows (account_id, tbl, pk, payload, updated_at, deleted, seq)
             VALUES (?1, 'habits', 'h1', '{}', 0, 0, 1)",
            [alice],
        )
        .unwrap();
        grant(&c, alice, bob, true, false); // alice -> bob: bob must rebuild
        grant(&c, carol, alice, true, true); // carol -> alice: carol is untouched
        let bob_rev = grant_rev(&c, bob);
        let carol_rev = grant_rev(&c, carol);

        assert!(matches!(delete_account_db(&c, "missing"), Err(AdminError::NotFound)));
        delete_account_db(&c, "alice").unwrap();

        assert_eq!(grant_rev(&c, bob), bob_rev + 1);
        assert_eq!(grant_rev(&c, carol), carol_rev);
        let count = |sql: &str| -> i64 { c.query_row(sql, [alice], |r| r.get(0)).unwrap() };
        assert_eq!(count("SELECT COUNT(*) FROM accounts WHERE id = ?1"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM rows WHERE account_id = ?1"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM tokens WHERE account_id = ?1"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM passkeys WHERE account_id = ?1"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM shares WHERE owner_id = ?1 OR grantee_id = ?1"), 0);
        assert!(matches!(delete_account_db(&c, "alice"), Err(AdminError::NotFound)));
    }

    /// `account list` needs tokens, passkeys and a row count inline — this is
    /// the whole reason the listing grew past `{name, created_at}`.
    #[test]
    fn list_accounts_includes_tokens_passkeys_and_rows() {
        let c = mem(None);
        let alice = make_account(&c, "alice");
        mint_token(&c, alice, "laptop").unwrap();
        make_passkey(&c, alice, "cred1");
        c.execute(
            "INSERT INTO rows (account_id, tbl, pk, payload, updated_at, deleted, seq)
             VALUES (?1, 'habits', 'h1', '{}', 0, 0, 1)",
            [alice],
        )
        .unwrap();
        c.execute("UPDATE accounts SET totp_secret = 's', totp_confirmed = 0 WHERE id = ?1", [alice])
            .unwrap();

        let out = list_accounts_db(&c).unwrap();
        let acct = out.iter().find(|a| a.name == "alice").unwrap();
        assert_eq!(acct.tokens.len(), 1);
        assert_eq!(acct.tokens[0].label, "laptop");
        assert_eq!(acct.passkeys.len(), 1);
        assert_eq!(acct.row_count, 1);
        assert!(!acct.has_password);
        assert!(!acct.totp_enabled, "unconfirmed enrollment reads as off");
    }

    /// The admin pair is named explicitly, listed server-wide, and still bumps
    /// the grantee's `grant_rev` like the self-service routes do.
    #[test]
    fn set_share_upserts_then_removes() {
        let c = mem(None);
        let alice = make_account(&c, "alice");
        let bob = make_account(&c, "bob");

        set_share_db(&c, "alice", "bob", true, false).unwrap();
        let list = list_shares_db(&c).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].owner_name.as_str(), list[0].grantee_name.as_str()), ("alice", "bob"));
        assert!(list[0].calendar && !list[0].todos);
        assert_eq!(grant_rev(&c, bob), 1);

        set_share_db(&c, "alice", "bob", true, true).unwrap();
        let list = list_shares_db(&c).unwrap();
        assert_eq!(list.len(), 1, "upsert, not a second row");
        assert!(list[0].todos);
        assert_eq!(grant_rev(&c, bob), 2);

        set_share_db(&c, "alice", "bob", false, false).unwrap();
        assert!(list_shares_db(&c).unwrap().is_empty());
        assert_eq!(grant_rev(&c, bob), 3, "removal bumps too");
        assert_eq!(grant_rev(&c, alice), 0, "the owner's own rev is untouched");

        assert!(matches!(set_share_db(&c, "alice", "nobody", true, true), Err(AdminError::NotFound)));
        assert!(matches!(set_share_db(&c, "alice", "alice", true, true), Err(AdminError::Invalid(_))));
    }

    #[test]
    fn label_revoke_and_clear_totp_are_scoped_to_the_named_account() {
        let c = mem(None);
        let alice = make_account(&c, "alice");
        make_account(&c, "bob");
        let pk = make_passkey(&c, alice, "cred1");
        mint_token(&c, alice, "laptop").unwrap();
        let tok: i64 =
            c.query_row("SELECT id FROM tokens WHERE account_id = ?1", [alice], |r| r.get(0)).unwrap();
        c.execute("UPDATE accounts SET totp_secret = 's', totp_confirmed = 1 WHERE id = ?1", [alice])
            .unwrap();

        assert!(matches!(label_passkey_db(&c, "bob", pk, Some("x")), Err(AdminError::NotFound)));
        assert!(matches!(label_passkey_db(&c, "alice", pk, Some(&"x".repeat(65))), Err(AdminError::Invalid(_))));
        label_passkey_db(&c, "alice", pk, Some(" YubiKey ")).unwrap();
        let label: Option<String> =
            c.query_row("SELECT label FROM passkeys WHERE id = ?1", [pk], |r| r.get(0)).unwrap();
        assert_eq!(label.as_deref(), Some("YubiKey"));
        label_passkey_db(&c, "alice", pk, None).unwrap();
        let label: Option<String> =
            c.query_row("SELECT label FROM passkeys WHERE id = ?1", [pk], |r| r.get(0)).unwrap();
        assert_eq!(label, None, "no label clears back to the derived name");

        assert!(matches!(revoke_token_db(&c, "bob", tok), Err(AdminError::NotFound)));
        revoke_token_db(&c, "alice", tok).unwrap();
        let left: i64 =
            c.query_row("SELECT COUNT(*) FROM tokens WHERE account_id = ?1", [alice], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);

        assert!(matches!(clear_totp_db(&c, "missing"), Err(AdminError::NotFound)));
        clear_totp_db(&c, "alice").unwrap();
        let (secret, confirmed): (Option<String>, i64) = c
            .query_row("SELECT totp_secret, totp_confirmed FROM accounts WHERE id = ?1", [alice], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert!(secret.is_none() && confirmed == 0);
    }
}
