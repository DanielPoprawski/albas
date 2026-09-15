//! What `albas-sync admin …` does to the database: one function per
//! subcommand, called by `admin.rs` inside a transaction. No HTTP here — the
//! CLI opens the same SQLite file the server has, so there is no admin token
//! and no `/admin/*` route surface (see `admin.rs` for why).

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::account::{name_ok, NAME_RULE};
use crate::auth::mint_token;
use crate::now_ms;
use crate::schema::OWNER;

/// What the `*_db` functions fail with. They are called from the CLI, which
/// has no HTTP status to map to, so the distinctions the old routes drew —
/// 404 / 409 / 422 / 500 — become variants, with the 409/422 reason carried
/// along for the CLI to print.
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
/// keep their local copy; the server just forgets it.
pub(crate) fn delete_account_db(conn: &Connection, name: &str) -> Result<(), AdminError> {
    let id = account_id(conn, name)?;
    delete_account_rows(conn, id)?;
    Ok(())
}

/// The one list of everything anchored to an account, shared by the admin
/// CLI and self-service deletion (`account.rs`). Nothing may be left behind:
/// `accounts.id` is a plain INTEGER PRIMARY KEY, so a later account can reuse
/// the number and would inherit any lockout counters, spent TOTP steps,
/// recovery codes or claimed sign-in sessions still keyed on it. The FKs have
/// no cascades, so the order matters: children first, and grantees bumped
/// *before* the shares that identify them are deleted.
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

/// Admin counterpart of `shares::set_share`: the pair is named explicitly
/// (there is no bearer identity to derive an owner from), otherwise the same
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
