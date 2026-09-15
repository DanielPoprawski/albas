//! The database: the tables (`SCHEMA`), how a connection is opened (`open`),
//! and the upgrade steps `init_db` runs on every boot.

use rusqlite::{params, Connection};
use std::time::Duration;

use crate::auth::{token_hash, TOKEN_TTL_MS};
use crate::now_ms;

pub(crate) const SCHEMA: &str = "
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
  -- Sliding 90-day expiry (see `auth::account_for_token`). Databases from
  -- before these columns get them from `ensure_token_columns`, backfilled to
  -- 0 = expired.
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
pub(crate) const OWNER: &str = "owner";

/// Opens the database file the server and the admin CLI share, upgrades it,
/// and returns a connection ready to serve: WAL (the CLI, `sqlite3` and
/// Litestream all read this file while the server runs), a five-second busy
/// timeout instead of `SQLITE_BUSY` on a short write lock, and foreign keys
/// enforced — see `enforce_foreign_keys` for why that comes last.
pub(crate) fn open(path: &str, owner_token: Option<&str>) -> Result<Connection, String> {
    let mut conn = Connection::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    init_db(&mut conn, owner_token)?;
    enforce_foreign_keys(&conn)?;
    Ok(conn)
}

/// `PRAGMA foreign_keys` is per connection. The bundled SQLite happens to
/// default it on (`SQLITE_DEFAULT_FOREIGN_KEYS`), a system one does not, and
/// `init_db` turns it off for the duration of the upgrade — so the serving
/// connection sets it explicitly, after `init_db`, rather than relying on a
/// build flag for every `REFERENCES` in `SCHEMA` to mean anything.
fn enforce_foreign_keys(conn: &Connection) -> Result<(), String> {
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|e| e.to_string())
}

/// An in-memory database in the exact state `open` leaves a real one in.
#[cfg(test)]
pub(crate) fn test_db(owner_token: Option<&str>) -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    init_db(&mut conn, owner_token).unwrap();
    enforce_foreign_keys(&conn).unwrap();
    conn
}

pub(crate) fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>, String> {
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
pub(crate) fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    def: &str,
) -> Result<(), String> {
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

    // `ALTER TABLE … RENAME` rewrites every `REFERENCES` clause that points
    // at the renamed table (always since SQLite 3.26; before that, and under
    // `legacy_alter_table`, whenever foreign keys are on). The v2 rebuild's
    // `accounts → accounts_v2` would then leave `rows`, `tokens` and the rest
    // referencing a table that is dropped a few statements later, and the
    // drop itself would trip the foreign-key check. Both pragmas together
    // are what keeps the clauses naming `accounts`; `foreign_keys` is a no-op
    // inside a transaction, hence set here rather than in `upgrade`.
    // `open` turns enforcement back on once the schema is current.
    conn.pragma_update(None, "foreign_keys", false)
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "legacy_alter_table", true)
        .map_err(|e| e.to_string())?;
    let result = upgrade(conn, legacy_v1, legacy_v2, owner_token);
    conn.pragma_update(None, "legacy_alter_table", false)
        .map_err(|e| e.to_string())?;
    result
}

fn upgrade(
    conn: &mut Connection,
    legacy_v1: bool,
    legacy_v2: bool,
    owner_token: Option<&str>,
) -> Result<(), String> {
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
        tx.execute_batch("DROP TABLE rows_v1;")
            .map_err(|e| e.to_string())?;
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
    ensure_column(
        &tx,
        "accounts",
        "totp_confirmed",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
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
    let id: i64 = conn.query_row("SELECT id FROM accounts WHERE name = ?1", [OWNER], |r| {
        r.get(0)
    })?;
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
