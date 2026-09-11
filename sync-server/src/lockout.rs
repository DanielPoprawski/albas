//! Per-account brute-force lockout, keyed by `(account_id, kind)` — `"password"`
//! or `"totp"`. This sits *underneath* the per-IP rate limiting layered onto
//! the auth routes in `main.rs`: that stops a wide scan across many accounts,
//! this stops a sustained guess against one specific account from behind a
//! NAT/VPN/proxy that shares an IP with legitimate traffic (or from many IPs).
//!
//! Ten failures locks the (account, kind) pair for fifteen minutes; any
//! success clears it. A lockout on `"totp"` does not lock `"password"` and
//! vice versa, since they guard different secrets.

use axum::http::StatusCode;
use rusqlite::{params, Connection, OptionalExtension};

use crate::now_ms;

type Rejection = (StatusCode, String);

const MAX_FAILURES: i64 = 10;
const LOCKOUT_MS: i64 = 15 * 60 * 1000;

fn internal(e: impl std::fmt::Display) -> Rejection {
    (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {e}"))
}

/// `Err((423 Locked, _))` when this account/kind is currently locked out.
pub(crate) fn check(conn: &Connection, account_id: i64, kind: &str) -> Result<(), Rejection> {
    let locked_until: Option<i64> = conn
        .query_row(
            "SELECT locked_until FROM auth_failures WHERE account_id = ?1 AND kind = ?2",
            params![account_id, kind],
            |r| r.get(0),
        )
        .optional()
        .map_err(internal)?;
    if let Some(until) = locked_until {
        if until > now_ms() {
            return Err((
                StatusCode::LOCKED,
                "Too many failed attempts. Try again in a few minutes.".into(),
            ));
        }
    }
    Ok(())
}

/// Records one failure; locks the account/kind for 15 minutes on the 10th
/// consecutive one (consecutive because any success calls `reset`).
pub(crate) fn record_failure(conn: &Connection, account_id: i64, kind: &str) -> Result<(), Rejection> {
    conn.execute(
        "INSERT INTO auth_failures (account_id, kind, count, locked_until) VALUES (?1, ?2, 1, 0)
         ON CONFLICT(account_id, kind) DO UPDATE SET count = count + 1",
        params![account_id, kind],
    )
    .map_err(internal)?;
    let count: i64 = conn
        .query_row(
            "SELECT count FROM auth_failures WHERE account_id = ?1 AND kind = ?2",
            params![account_id, kind],
            |r| r.get(0),
        )
        .map_err(internal)?;
    if count >= MAX_FAILURES {
        conn.execute(
            "UPDATE auth_failures SET locked_until = ?1 WHERE account_id = ?2 AND kind = ?3",
            params![now_ms() + LOCKOUT_MS, account_id, kind],
        )
        .map_err(internal)?;
    }
    Ok(())
}

/// Clears failures/lockout for this account/kind after a successful attempt.
pub(crate) fn reset(conn: &Connection, account_id: i64, kind: &str) -> Result<(), Rejection> {
    conn.execute(
        "DELETE FROM auth_failures WHERE account_id = ?1 AND kind = ?2",
        params![account_id, kind],
    )
    .map_err(internal)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        crate::init_db(&mut c, None).unwrap();
        c
    }

    #[test]
    fn locks_after_ten_failures_and_clears_on_reset() {
        let c = mem();
        c.execute("INSERT INTO accounts (name, created_at) VALUES ('a', 0)", []).unwrap();
        let id = c.last_insert_rowid();

        for _ in 0..9 {
            record_failure(&c, id, "password").unwrap();
            assert!(check(&c, id, "password").is_ok(), "not locked before the 10th failure");
        }
        record_failure(&c, id, "password").unwrap();
        let err = check(&c, id, "password").unwrap_err();
        assert_eq!(err.0, StatusCode::LOCKED);

        // A different kind on the same account is unaffected.
        assert!(check(&c, id, "totp").is_ok());

        reset(&c, id, "password").unwrap();
        assert!(check(&c, id, "password").is_ok());
    }
}
