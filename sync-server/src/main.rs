//! Albas sync endpoint.
//!
//! Deliberately knows nothing about todos, events or weights: it is a generic
//! `(account, table, pk) -> payload` store. Every row carries the client's
//! `updated_at` (for last-write-wins) and a server-assigned `seq` (for the pull
//! watermark). Adding a column to the app schema therefore needs no change here.
//!
//! Accounts: each person owns an isolated row set. A bearer token *is* the
//! identity — `/sync` maps it to an account through the `tokens` table (one row
//! per device/login, only SHA-256 hashes stored). Tokens are minted three ways:
//! passkey login/registration (`passkey.rs`), the admin `/accounts` endpoint,
//! and the `ALBAS_SYNC_TOKEN` env var (which owns the `owner` account's
//! `env`-labelled token, rotating with the var as it always did).
//!
//! Sharing: `shares` grants another account read-only access to table groups
//! (`calendar` = events+periods, `todos` = habits+completions+tasks — the
//! server can't split todos from habits because it never parses payloads, and
//! weights are structurally never shareable). `/sync` returns shared rows
//! alongside the account's own; `accounts.grant_rev` is bumped on every grant
//! change so a client can detect that its shared snapshot is stale and rebuild
//! from zero.
//!
//! Why two clocks: `updated_at` comes from whichever device made the edit, so
//! it is only as good as that device's clock — fine for deciding which of two
//! edits wins. `seq` is assigned here, strictly increasing, and is what clients
//! resume from, so a wrong device clock can never make a client skip a row.
//!
//! Admin console (`/admin/*`, all `admin_ok`-gated): the self-service `/shares`
//! trio is scoped to whichever account the bearer token identifies, which an
//! admin token is not — it names no account. So the admin console gets its own
//! routes rather than reusing those: `/admin/shares` lists every grant on the
//! server, `/admin/shares/:owner/:grantee` edits or revokes one by name, and
//! `/admin/rows` browses the row store directly, filterable by account/table.
//! `GET /accounts` (unchanged path) now returns each account's tokens, passkeys
//! and row count inline instead of just `{name, created_at}`, since that is
//! what the console's Accounts panel needs and nothing else calls this route.
//!
//! **Invites are not getting further admin support.** The product direction
//! (2026-08) is open signup only — anyone with the site link can create an
//! account — so there is deliberately no `/admin/invites` listing or revoke
//! endpoint here, and the console has no Invites panel. `POST /invites` in
//! `passkey.rs` still exists for `ALBAS_SYNC_SIGNUPS=invite` deployments and
//! for attaching a passkey to an existing account, but is not wired into the
//! console. See root `CLAUDE.md`, "Project direction".

mod app_session;
mod google;
mod passkey;
mod password;
mod totp;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get, post, put},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};

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
  created_at   INTEGER NOT NULL
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
";

/// The account every pre-account database's rows are assigned to, and the one
/// `ALBAS_SYNC_TOKEN` keeps pointing at.
const OWNER: &str = "owner";

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Signups {
    Open,
    InviteOnly,
}

pub(crate) struct AppState {
    pub(crate) conn: Mutex<Connection>,
    pub(crate) admin_token: Option<String>,
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

#[derive(Deserialize)]
struct NewAccount {
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatedAccount {
    name: String,
    /// Shown exactly once — only its hash is stored.
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TokenInfo {
    id: i64,
    account_id: i64,
    label: String,
    created_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PasskeyInfo {
    id: i64,
    account_id: i64,
    cred_id: String,
    created_at: i64,
}

/// `GET /accounts` response shape. Named for what the admin console shows,
/// not for `AccountInfo`'s old, thinner one — nothing else consumes this route.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountDetail {
    id: i64,
    name: String,
    created_at: i64,
    grant_rev: i64,
    tokens: Vec<TokenInfo>,
    passkeys: Vec<PasskeyInfo>,
    row_count: i64,
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

#[tokio::main]
async fn main() {
    let owner_token = env_token("ALBAS_SYNC_TOKEN");
    let admin_token = env_token("ALBAS_SYNC_ADMIN_TOKEN");
    let db_path = std::env::var("ALBAS_SYNC_DB").unwrap_or_else(|_| "/data/albas-sync.db".into());
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
    init_db(&mut conn, owner_token.as_deref()).expect("failed to initialise database");

    let n_accounts: i64 = conn
        .query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0))
        .expect("count accounts");
    if n_accounts == 0 && admin_token.is_none() && webauthn.is_none() {
        panic!(
            "no accounts exist and no way to create one: set ALBAS_SYNC_ORIGIN (to enable \
             passkey signup), ALBAS_SYNC_ADMIN_TOKEN (to mint accounts via POST /accounts), \
             and/or ALBAS_SYNC_TOKEN (which becomes the '{OWNER}' account)"
        );
    }

    let state = Arc::new(AppState {
        conn: Mutex::new(conn),
        admin_token,
        signups,
        webauthn,
        assetlinks,
        pending: passkey::Pending::default(),
        google,
        google_pending: google::Pending::default(),
    });

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/sync", post(sync))
        .route("/accounts", post(create_account).get(list_accounts))
        .route("/accounts/:name", delete(delete_account))
        .route("/shares", get(shares_get))
        .route("/shares/:name", put(shares_put).delete(shares_delete))
        .route("/admin/shares", get(admin_shares_get))
        .route(
            "/admin/shares/:owner/:grantee",
            put(admin_share_put).delete(admin_share_delete),
        )
        .route("/admin/rows", get(admin_rows))
        .route("/app-session", post(app_session::create))
        .route("/app-session/claim", post(app_session::claim))
        .route("/app-session/:nonce", get(app_session::poll))
        .route("/auth/config", get(google::config))
        .route("/auth/google/start", get(google::start))
        .route("/auth/google/callback", get(google::callback))
        .route("/auth/google/session/:ticket", get(google::session))
        .route("/register/start", post(passkey::register_start))
        .route("/register/finish", post(passkey::register_finish))
        .route("/login/start", post(passkey::login_start))
        .route("/login/finish", post(passkey::login_finish))
        .route("/invites", post(passkey::create_invite))
        .route("/passkeys", get(passkey::list_passkeys))
        .route("/passkeys/start", post(passkey::add_passkey_start))
        .route("/passkeys/finish", post(passkey::add_passkey_finish))
        .route(
            "/password",
            get(password::password_status)
                .put(password::set_password)
                .delete(password::clear_password),
        )
        .route("/login/password", post(password::login_password))
        .route("/totp", get(totp::totp_status).delete(totp::disable_totp))
        .route("/totp/enroll", post(totp::enroll_start))
        .route("/totp/confirm", post(totp::enroll_confirm))
        .route("/.well-known/assetlinks.json", get(passkey::assetlinks))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind");
    println!("albas-sync listening on {addr}, db at {db_path}");
    axum::serve(listener, app).await.expect("serve");
}

/// Reads a token env var, treating empty as unset and refusing weak values.
fn env_token(name: &str) -> Option<String> {
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
fn init_db(conn: &mut Connection, owner_token: Option<&str>) -> Result<(), String> {
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
        tx.execute_batch(
            "INSERT INTO accounts (id, name, created_at)
               SELECT id, name, created_at FROM accounts_v2;
             INSERT INTO tokens (account_id, token_hash, label, created_at)
               SELECT id, token_hash, 'migrated', created_at FROM accounts_v2;
             DROP TABLE accounts_v2;",
        )
        .map_err(|e| e.to_string())?;
        if let Some(token) = owner_token {
            upsert_owner(&tx, token).map_err(|e| e.to_string())?;
        }
    } else {
        tx.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        if let Some(token) = owner_token {
            upsert_owner(&tx, token).map_err(|e| e.to_string())?;
        }
    }
    // Columns added to `accounts` after it first shipped. Idempotent, and run
    // on every path above — the two rebuild branches recreate the table from
    // SCHEMA and so already have them, which is exactly what makes this safe
    // to run unconditionally.
    ensure_column(&tx, "accounts", "grant_rev", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(&tx, "accounts", "password_hash", "TEXT")?;
    ensure_column(&tx, "accounts", "totp_secret", "TEXT")?;
    ensure_column(&tx, "accounts", "totp_confirmed", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(&tx, "accounts", "google_email", "TEXT")?;
    tx.commit().map_err(|e| e.to_string())
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
    conn.execute(
        "INSERT OR IGNORE INTO tokens (account_id, token_hash, label, created_at)
         VALUES (?1, ?2, 'env', ?3)",
        params![id, h, now_ms()],
    )?;
    Ok(id)
}

/// Mints a fresh bearer token for an account and stores its hash.
pub(crate) fn mint_token(conn: &Connection, account_id: i64, label: &str) -> rusqlite::Result<String> {
    let token = random_token();
    conn.execute(
        "INSERT INTO tokens (account_id, token_hash, label, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![account_id, token_hash(&token), label, now_ms()],
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
pub(crate) fn account_for(conn: &Connection, headers: &HeaderMap) -> Option<i64> {
    let token = bearer(headers)?;
    conn.query_row(
        "SELECT account_id FROM tokens WHERE token_hash = ?1",
        [token_hash(token)],
        |r| r.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

/// Length-checked, non-short-circuiting compare so a wrong admin token doesn't
/// leak its correct prefix through response timing.
fn token_ok(expected: &str, got: &str) -> bool {
    if expected.len() != got.len() {
        return false;
    }
    expected
        .bytes()
        .zip(got.bytes())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

/// Admin endpoints are disabled outright (403) unless ALBAS_SYNC_ADMIN_TOKEN
/// is configured; a wrong credential is 401.
pub(crate) fn admin_ok(state: &AppState, headers: &HeaderMap) -> Result<(), StatusCode> {
    let expected = state.admin_token.as_deref().ok_or(StatusCode::FORBIDDEN)?;
    match bearer(headers) {
        Some(got) if token_ok(expected, got) => Ok(()),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

/// The tables a grant exposes. Weights never appear in any group, so they are
/// structurally unshareable. Todos and habits live in the same tables, hence
/// one combined group.
fn granted_tables(calendar: bool, todos: bool) -> Vec<&'static str> {
    let mut v = Vec::new();
    if calendar {
        v.extend(["events", "periods"]);
    }
    if todos {
        v.extend(["habits", "habit_completions", "tasks"]);
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

async fn create_account(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<NewAccount>,
) -> Result<(StatusCode, Json<CreatedAccount>), StatusCode> {
    admin_ok(&state, &headers)?;
    let name = req.name.trim().to_string();
    if !name_ok(&name) {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    let mut guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tx = guard.transaction().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    match tx.execute(
        "INSERT INTO accounts (name, created_at) VALUES (?1, ?2)",
        params![name, now_ms()],
    ) {
        Ok(_) => {}
        Err(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            return Err(StatusCode::CONFLICT)
        }
        Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
    let id = tx.last_insert_rowid();
    let token = mint_token(&tx, id, "admin").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((StatusCode::CREATED, Json(CreatedAccount { name, token })))
}

pub(crate) fn name_ok(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

async fn list_accounts(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<AccountDetail>>, StatusCode> {
    admin_ok(&state, &headers)?;
    let guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut stmt = guard
        .prepare("SELECT id, name, created_at, grant_rev FROM accounts ORDER BY created_at")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let accounts: Vec<(i64, String, i64, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .and_then(|rows| rows.collect())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut out = Vec::with_capacity(accounts.len());
    for (id, name, created_at, grant_rev) in accounts {
        let mut tstmt = guard
            .prepare("SELECT id, label, created_at FROM tokens WHERE account_id = ?1 ORDER BY created_at")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let tokens = tstmt
            .query_map([id], |r| {
                Ok(TokenInfo { id: r.get(0)?, account_id: id, label: r.get(1)?, created_at: r.get(2)? })
            })
            .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let mut pstmt = guard
            .prepare("SELECT id, cred_id, created_at FROM passkeys WHERE account_id = ?1 ORDER BY created_at")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let passkeys = pstmt
            .query_map([id], |r| {
                Ok(PasskeyInfo { id: r.get(0)?, account_id: id, cred_id: r.get(1)?, created_at: r.get(2)? })
            })
            .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let row_count: i64 = guard
            .query_row("SELECT COUNT(*) FROM rows WHERE account_id = ?1", [id], |r| r.get(0))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        out.push(AccountDetail { id, name, created_at, grant_rev, tokens, passkeys, row_count });
    }
    Ok(Json(out))
}

/// Removes the account and everything anchored to it — rows, tokens, passkeys,
/// shares in both directions. Revocation, not archival: the person's devices
/// keep their local copy; the server just forgets it.
async fn delete_account(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Result<StatusCode, StatusCode> {
    admin_ok(&state, &headers)?;
    let mut guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tx = guard
        .transaction()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let id: Option<i64> = tx
        .query_row("SELECT id FROM accounts WHERE name = ?1", [&name], |r| r.get(0))
        .optional()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let Some(id) = id else {
        return Err(StatusCode::NOT_FOUND);
    };
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
        tx.execute(sql, [id]).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
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
) -> Result<StatusCode, StatusCode> {
    set_share(&state, &headers, &name, body.calendar, body.todos)
}

async fn shares_delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Result<StatusCode, StatusCode> {
    set_share(&state, &headers, &name, false, false)
}

fn set_share(
    state: &AppState,
    headers: &HeaderMap,
    grantee_name: &str,
    calendar: bool,
    todos: bool,
) -> Result<StatusCode, StatusCode> {
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
        return Err(StatusCode::NOT_FOUND);
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
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminShare {
    owner_id: i64,
    grantee_id: i64,
    owner_name: String,
    grantee_name: String,
    calendar: bool,
    todos: bool,
}

/// Every grant on the server, not just the caller's — `set_share`'s `me` comes
/// from the bearer token, which an admin token does not resolve to any
/// account, so this is a separate route rather than a mode of `/shares`.
async fn admin_shares_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<AdminShare>>, StatusCode> {
    admin_ok(&state, &headers)?;
    let guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut stmt = guard
        .prepare(
            "SELECT s.owner_id, s.grantee_id, o.name, g.name, s.calendar, s.todos
             FROM shares s
             JOIN accounts o ON o.id = s.owner_id
             JOIN accounts g ON g.id = s.grantee_id
             ORDER BY o.name, g.name",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
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
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(out))
}

async fn admin_share_put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((owner, grantee)): Path<(String, String)>,
    Json(body): Json<ShareBody>,
) -> Result<StatusCode, StatusCode> {
    admin_set_share(&state, &headers, &owner, &grantee, body.calendar, body.todos)
}

async fn admin_share_delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((owner, grantee)): Path<(String, String)>,
) -> Result<StatusCode, StatusCode> {
    admin_set_share(&state, &headers, &owner, &grantee, false, false)
}

/// Admin counterpart of `set_share`: the pair is named explicitly by the admin
/// (there is no bearer identity to derive an owner from), otherwise the same
/// upsert-or-delete-plus-`grant_rev`-bump rule.
fn admin_set_share(
    state: &AppState,
    headers: &HeaderMap,
    owner_name: &str,
    grantee_name: &str,
    calendar: bool,
    todos: bool,
) -> Result<StatusCode, StatusCode> {
    admin_ok(state, headers)?;
    let mut guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tx = guard.transaction().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let owner: Option<i64> = tx
        .query_row("SELECT id FROM accounts WHERE name = ?1", [owner_name], |r| r.get(0))
        .optional()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let grantee: Option<i64> = tx
        .query_row("SELECT id FROM accounts WHERE name = ?1", [grantee_name], |r| r.get(0))
        .optional()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let (Some(owner), Some(grantee)) = (owner, grantee) else {
        return Err(StatusCode::NOT_FOUND);
    };
    if owner == grantee {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    if !calendar && !todos {
        tx.execute(
            "DELETE FROM shares WHERE owner_id = ?1 AND grantee_id = ?2",
            params![owner, grantee],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else {
        tx.execute(
            "INSERT INTO shares (owner_id, grantee_id, calendar, todos) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(owner_id, grantee_id) DO UPDATE SET
               calendar = excluded.calendar, todos = excluded.todos",
            params![owner, grantee, calendar as i64, todos as i64],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    tx.execute("UPDATE accounts SET grant_rev = grant_rev + 1 WHERE id = ?1", [grantee])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct RowsQuery {
    account: Option<String>,
    table: Option<String>,
    limit: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminRow {
    account_id: i64,
    account_name: String,
    tbl: String,
    pk: String,
    updated_at: i64,
    deleted: bool,
    seq: i64,
}

/// Browses the row store directly — table/pk/seq/tombstone only, never the
/// payload, matching the console's "never parses payloads" schema note.
/// `account`/`table` of `"all"` or empty are treated as no filter.
async fn admin_rows(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<RowsQuery>,
) -> Result<Json<Vec<AdminRow>>, StatusCode> {
    admin_ok(&state, &headers)?;
    let limit = q.limit.unwrap_or(200).clamp(1, 1000);
    let guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut sql = String::from(
        "SELECT r.account_id, a.name, r.tbl, r.pk, r.updated_at, r.deleted, r.seq
         FROM rows r JOIN accounts a ON a.id = r.account_id WHERE 1=1",
    );
    let mut binds: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(account) = q.account.as_deref().filter(|s| !s.is_empty() && *s != "all") {
        sql.push_str(" AND a.name = ?");
        binds.push(Box::new(account.to_string()));
    }
    if let Some(table) = q.table.as_deref().filter(|s| !s.is_empty() && *s != "all") {
        sql.push_str(" AND r.tbl = ?");
        binds.push(Box::new(table.to_string()));
    }
    sql.push_str(" ORDER BY r.seq DESC LIMIT ?");
    binds.push(Box::new(limit));

    let mut stmt = guard.prepare(&sql).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
    let out = stmt
        .query_map(param_refs.as_slice(), |r| {
            Ok(AdminRow {
                account_id: r.get(0)?,
                account_name: r.get(1)?,
                tbl: r.get(2)?,
                pk: r.get(3)?,
                updated_at: r.get(4)?,
                deleted: r.get::<_, i64>(5)? != 0,
                seq: r.get(6)?,
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_compare_rejects_prefixes_and_wrong_lengths() {
        assert!(token_ok("supersecrettoken", "supersecrettoken"));
        assert!(!token_ok("supersecrettoken", "supersecrettoke"));
        assert!(!token_ok("supersecrettoken", "supersecrettokenx"));
        assert!(!token_ok("supersecrettoken", "Supersecrettoken"));
    }

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
    /// grantee — never weights, never a third account.
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
                change("weights", "w1", "{\"weight_kg\":80}", 100),
            ]),
        )
        .unwrap();

        let bob_pull = apply_sync(&tx, bob, &SyncReq { since: 0, changes: vec![], shared_since: 0, grant_rev: 1 })
            .unwrap();
        let tbls: Vec<&str> = bob_pull.shared.iter().map(|s| s.tbl.as_str()).collect();
        assert!(tbls.contains(&"events") && tbls.contains(&"periods"));
        assert!(!tbls.contains(&"habits"), "todos group was not granted");
        assert!(!tbls.contains(&"weights"), "weights are never shareable");
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

    fn admin_state(c: Connection, admin_token: Option<&str>) -> Arc<AppState> {
        Arc::new(AppState {
            conn: Mutex::new(c),
            admin_token: admin_token.map(str::to_string),
            signups: Signups::Open,
            webauthn: None,
            assetlinks: None,
            pending: passkey::Pending::default(),
            google: None,
            google_pending: Default::default(),
        })
    }

    fn admin_headers() -> HeaderMap {
        auth_headers("admin-test-token-000000")
    }

    /// The console's Accounts panel needs tokens, passkeys and a row count
    /// inline — this is the whole reason `list_accounts` grew past
    /// `{name, created_at}`.
    #[tokio::test]
    async fn admin_list_accounts_includes_tokens_passkeys_and_rows() {
        let c = mem(None);
        let alice = make_account(&c, "alice");
        mint_token(&c, alice, "laptop").unwrap();
        c.execute(
            "INSERT INTO passkeys (account_id, cred_id, passkey_json, created_at) VALUES (?1, 'cred1', '{}', 0)",
            [alice],
        )
        .unwrap();
        c.execute(
            "INSERT INTO rows (account_id, tbl, pk, payload, updated_at, deleted, seq)
             VALUES (?1, 'habits', 'h1', '{}', 0, 0, 1)",
            [alice],
        )
        .unwrap();

        let state = admin_state(c, Some("admin-test-token-000000"));
        match list_accounts(State(state.clone()), HeaderMap::new()).await {
            Err(status) => assert_eq!(status, StatusCode::UNAUTHORIZED),
            Ok(_) => panic!("expected admin_ok to reject an unauthenticated request"),
        }

        let out = list_accounts(State(state), admin_headers()).await.unwrap().0;
        let acct = out.iter().find(|a| a.name == "alice").unwrap();
        assert_eq!(acct.tokens.len(), 1);
        assert_eq!(acct.tokens[0].label, "laptop");
        assert_eq!(acct.passkeys.len(), 1);
        assert_eq!(acct.row_count, 1);
    }

    /// The admin trio operates on an explicit owner/grantee pair rather than a
    /// bearer identity, lists every grant on the server, and still bumps the
    /// grantee's `grant_rev` like the self-service routes do.
    #[tokio::test]
    async fn admin_shares_list_edit_and_revoke() {
        let c = mem(None);
        let alice = make_account(&c, "alice");
        let _bob = make_account(&c, "bob");
        let state = admin_state(c, Some("admin-test-token-000000"));

        let status = admin_share_put(
            State(state.clone()),
            admin_headers(),
            Path(("alice".to_string(), "bob".to_string())),
            Json(ShareBody { calendar: true, todos: false }),
        )
        .await
        .unwrap();
        assert_eq!(status, StatusCode::NO_CONTENT);

        let list = admin_shares_get(State(state.clone()), admin_headers()).await.unwrap().0;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].owner_name, "alice");
        assert_eq!(list[0].grantee_name, "bob");
        assert!(list[0].calendar && !list[0].todos);

        let rev_of = |c: &Connection, id: i64| -> i64 {
            c.query_row("SELECT grant_rev FROM accounts WHERE id = ?1", [id], |r| r.get(0)).unwrap()
        };
        {
            let guard = state.conn.lock().unwrap();
            let bob_id: i64 =
                guard.query_row("SELECT id FROM accounts WHERE name = 'bob'", [], |r| r.get(0)).unwrap();
            assert_eq!(rev_of(&guard, bob_id), 1);
        }

        let status =
            admin_share_delete(State(state.clone()), admin_headers(), Path(("alice".to_string(), "bob".to_string())))
                .await
                .unwrap();
        assert_eq!(status, StatusCode::NO_CONTENT);
        let list = admin_shares_get(State(state.clone()), admin_headers()).await.unwrap().0;
        assert!(list.is_empty());

        let missing = admin_share_put(
            State(state),
            admin_headers(),
            Path(("alice".to_string(), "nobody".to_string())),
            Json(ShareBody { calendar: true, todos: true }),
        )
        .await;
        assert_eq!(missing.unwrap_err(), StatusCode::NOT_FOUND);
        let _ = alice;
    }

    #[tokio::test]
    async fn admin_rows_filters_by_account_and_table() {
        let c = mem(None);
        let alice = make_account(&c, "alice");
        let bob = make_account(&c, "bob");
        for (acct, tbl, pk) in [(alice, "habits", "h1"), (alice, "events", "e1"), (bob, "habits", "h2")] {
            c.execute(
                "INSERT INTO rows (account_id, tbl, pk, payload, updated_at, deleted, seq)
                 VALUES (?1, ?2, ?3, '{}', 0, 0, (SELECT COALESCE(MAX(seq), 0) + 1 FROM rows))",
                params![acct, tbl, pk],
            )
            .unwrap();
        }
        let state = admin_state(c, Some("admin-test-token-000000"));

        let all = admin_rows(State(state.clone()), admin_headers(), Query(RowsQuery { account: None, table: None, limit: None }))
            .await
            .unwrap()
            .0;
        assert_eq!(all.len(), 3);

        let alice_only = admin_rows(
            State(state.clone()),
            admin_headers(),
            Query(RowsQuery { account: Some("alice".into()), table: None, limit: None }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(alice_only.len(), 2);
        assert!(alice_only.iter().all(|r| r.account_name == "alice"));

        let habits_only = admin_rows(
            State(state),
            admin_headers(),
            Query(RowsQuery { account: None, table: Some("habits".into()), limit: None }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(habits_only.len(), 2);
        assert!(habits_only.iter().all(|r| r.tbl == "habits"));
    }
}
