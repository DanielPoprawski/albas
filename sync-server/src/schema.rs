//! Schema creation and upgrade: `init_db` and the `ensure_column` helpers it
//! runs on every boot (see `SCHEMA` in `main.rs` for the tables themselves).

use rusqlite::{params, Connection};

use crate::{now_ms, token_hash, OWNER, SCHEMA, TOKEN_TTL_MS};

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
pub(crate) fn ensure_column(conn: &Connection, table: &str, column: &str, def: &str) -> Result<(), String> {
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
