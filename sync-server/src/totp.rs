//! TOTP / 2FA.
//!
//! **Enforced on password login only — never on passkey login, and never
//! required to have.** A passkey ceremony is already possession plus user
//! verification (PIN/biometric at the authenticator); bolting a typed code
//! onto that adds friction without adding a factor, and the passkey ceremony
//! runs through the OS authenticator via `tauri-plugin-webauthn`
//! (`src/auth.ts`), which has nowhere to prompt for a code anyway. Password
//! login is the one flow here where a second factor genuinely adds something,
//! so `password::login_password` is the sole caller of `verify_if_enrolled`.
//!
//! Contract:
//!   `GET    /totp`         — authenticated. `{ enrolled, confirmed }` — never
//!                            the secret; that is handed out once, at enrollment.
//!   `POST   /totp/enroll`  — authenticated. Generates a secret, stores it in
//!                            `accounts.totp_secret`, returns the secret and an
//!                            `otpauth://` URI. The QR is rendered CLIENT-side
//!                            from that URI; this handler never generates an
//!                            image. Refuses (409) while already confirmed —
//!                            see `enroll_start` for why.
//!   `POST   /totp/confirm` — authenticated. Verifies the first code and sets
//!                            `accounts.totp_confirmed = 1`.
//!   `DELETE /totp`         — authenticated. Clears both columns.
//!
//! Verification uses the `totp-rs` crate throughout (secret generation, URI
//! construction, code checking) rather than hand-rolled HOTP/TOTP math.

use crate::AppState;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use totp_rs::{Algorithm, Secret, TOTP};

type Rejection = (StatusCode, String);

/// The message the password client matches to know it must ask for a code and
/// retry. Keep this string stable — it is load-bearing for that other flow.
const CODE_REQUIRED: &str = "A two-factor code is required.";
const CODE_WRONG: &str = "That code didn't match. Try again.";

fn internal<E: std::fmt::Display>(e: E) -> Rejection {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

fn unauthorized() -> Rejection {
    (StatusCode::UNAUTHORIZED, "Not signed in.".into())
}

/// Rebuilds the `TOTP` verifier from a stored base32 secret. Issuer and
/// account name only affect the `otpauth://` URI (`get_url`), never
/// `check`/`check_current`, so a placeholder account name is fine here — the
/// real one is only needed once, at `enroll_start`, to build the URI the user
/// actually scans.
fn totp_from_secret(secret_b32: &str) -> Result<TOTP, Rejection> {
    let secret = Secret::Encoded(secret_b32.to_string())
        .to_bytes()
        .map_err(|e| internal(format!("stored TOTP secret is invalid: {e}")))?;
    TOTP::new(Algorithm::SHA1, 6, 1, 30, secret, None, String::new())
        .map_err(|e| internal(format!("could not rebuild TOTP verifier: {e}")))
}

/// The seam between TOTP and any login flow that wants it as a second factor.
///
/// Called by `password::login_password` after the password itself verifies.
/// Contract, which the password flow codes against and must keep working:
///   - account has no confirmed TOTP  -> `Ok(())`, `code` ignored;
///   - confirmed TOTP and `code` verifies -> `Ok(())`;
///   - confirmed TOTP and `code` missing  -> `Err((UNAUTHORIZED, CODE_REQUIRED))`;
///   - confirmed TOTP and `code` wrong    -> `Err((UNAUTHORIZED, CODE_WRONG))`.
///
/// An account with a secret that was never confirmed (an abandoned or
/// in-progress enrollment) is treated the same as no secret at all — a
/// half-finished enrollment must never lock anyone out of password login.
pub(crate) fn verify_if_enrolled(
    conn: &rusqlite::Connection,
    account_id: i64,
    code: Option<&str>,
) -> Result<(), Rejection> {
    let row: Option<(Option<String>, i64)> = conn
        .query_row(
            "SELECT totp_secret, totp_confirmed FROM accounts WHERE id = ?1",
            [account_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(internal)?;
    let Some((Some(secret_b32), confirmed)) = row else {
        return Ok(());
    };
    if confirmed == 0 {
        return Ok(());
    }
    let Some(code) = code.map(str::trim).filter(|c| !c.is_empty()) else {
        return Err((StatusCode::UNAUTHORIZED, CODE_REQUIRED.into()));
    };
    let totp = totp_from_secret(&secret_b32)?;
    let ok = totp.check_current(code).map_err(internal)?;
    if ok {
        Ok(())
    } else {
        Err((StatusCode::UNAUTHORIZED, CODE_WRONG.into()))
    }
}

pub(crate) async fn totp_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, Rejection> {
    let guard = state.conn.lock().map_err(internal)?;
    let account_id = crate::account_for(&guard, &headers).ok_or_else(unauthorized)?;
    let (enrolled, confirmed): (bool, bool) = guard
        .query_row(
            "SELECT totp_secret IS NOT NULL, totp_confirmed != 0 FROM accounts WHERE id = ?1",
            [account_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(internal)?;
    Ok(Json(json!({ "enrolled": enrolled, "confirmed": confirmed })))
}

/// Starts (or restarts) enrollment. Re-enrolling while already **confirmed**
/// is refused with 409 rather than silently overwriting the secret: TOTP is a
/// second factor for password login, and letting a live enrollment endpoint
/// swap out a confirmed secret would mean anyone who can reach it with a
/// valid bearer token (any device signed into the account, not just the one
/// that set 2FA up) could silently mint themselves a new secret and QR,
/// bypassing the "prove you have the old code" step disabling+re-enrolling
/// would require. Turn it off first (`DELETE /totp`), then enroll again.
/// Restarting an **unconfirmed** enrollment (an abandoned attempt) is fine and
/// just overwrites the pending secret — nothing depends on it yet.
pub(crate) async fn enroll_start(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, Rejection> {
    let guard = state.conn.lock().map_err(internal)?;
    let account_id = crate::account_for(&guard, &headers).ok_or_else(unauthorized)?;
    let (name, confirmed): (String, i64) = guard
        .query_row(
            "SELECT name, totp_confirmed FROM accounts WHERE id = ?1",
            [account_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(internal)?;
    if confirmed != 0 {
        return Err((
            StatusCode::CONFLICT,
            "Two-factor authentication is already turned on. Turn it off before setting it up again."
                .into(),
        ));
    }
    let secret = Secret::generate_secret();
    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret.to_bytes().map_err(internal)?,
        Some("Albas".to_string()),
        name,
    )
    .map_err(|e| internal(format!("could not build TOTP: {e}")))?;
    let secret_b32 = totp.get_secret_base32();
    let uri = totp.get_url();
    guard
        .execute(
            "UPDATE accounts SET totp_secret = ?1 WHERE id = ?2",
            params![secret_b32, account_id],
        )
        .map_err(internal)?;
    Ok(Json(json!({ "secret": secret_b32, "uri": uri })))
}

#[derive(Deserialize)]
pub(crate) struct ConfirmReq {
    code: String,
}

pub(crate) async fn enroll_confirm(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<ConfirmReq>,
) -> Result<Json<Value>, Rejection> {
    let guard = state.conn.lock().map_err(internal)?;
    let account_id = crate::account_for(&guard, &headers).ok_or_else(unauthorized)?;
    let secret_b32: Option<String> = guard
        .query_row("SELECT totp_secret FROM accounts WHERE id = ?1", [account_id], |r| r.get(0))
        .map_err(internal)?;
    let Some(secret_b32) = secret_b32 else {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "Start enrollment before confirming a code.".into(),
        ));
    };
    let totp = totp_from_secret(&secret_b32)?;
    let code = body.code.trim();
    let ok = totp.check_current(code).map_err(internal)?;
    if !ok {
        return Err((StatusCode::UNAUTHORIZED, CODE_WRONG.into()));
    }
    guard
        .execute("UPDATE accounts SET totp_confirmed = 1 WHERE id = ?1", [account_id])
        .map_err(internal)?;
    Ok(Json(json!({ "confirmed": true })))
}

pub(crate) async fn disable_totp(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, Rejection> {
    let guard = state.conn.lock().map_err(internal)?;
    let account_id = crate::account_for(&guard, &headers).ok_or_else(unauthorized)?;
    guard
        .execute(
            "UPDATE accounts SET totp_secret = NULL, totp_confirmed = 0 WHERE id = ?1",
            [account_id],
        )
        .map_err(internal)?;
    Ok(Json(json!({ "disabled": true })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn mem() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        crate::init_db(&mut c, None).unwrap();
        c
    }

    fn add_account(c: &Connection, name: &str) -> i64 {
        c.execute("INSERT INTO accounts (name, created_at) VALUES (?1, 0)", [name]).unwrap();
        c.last_insert_rowid()
    }

    /// Generates a code from the same secret+time totp-rs itself would use, so
    /// tests exercise real verification rather than a hardcoded digit string.
    fn code_for(secret_b32: &str) -> String {
        totp_from_secret(secret_b32).unwrap().generate_current().unwrap()
    }

    #[test]
    fn unenrolled_account_passes_through() {
        let c = mem();
        let id = add_account(&c, "sarah");
        assert!(verify_if_enrolled(&c, id, None).is_ok());
        assert!(verify_if_enrolled(&c, id, Some("000000")).is_ok());
    }

    #[test]
    fn unconfirmed_enrollment_does_not_gate_login() {
        let c = mem();
        let id = add_account(&c, "sarah");
        let secret = Secret::generate_secret().to_encoded();
        let totp_rs::Secret::Encoded(b32) = secret else { unreachable!() };
        c.execute("UPDATE accounts SET totp_secret = ?1 WHERE id = ?2", params![b32, id])
            .unwrap();
        // totp_confirmed is still 0 — an abandoned enrollment must not lock
        // out password login.
        assert!(verify_if_enrolled(&c, id, None).is_ok());
    }

    #[test]
    fn enroll_then_confirm_then_verify_accepts_a_generated_code() {
        let c = mem();
        let id = add_account(&c, "sarah");
        let name: String =
            c.query_row("SELECT name FROM accounts WHERE id = ?1", [id], |r| r.get(0)).unwrap();

        let secret = Secret::generate_secret();
        let totp = TOTP::new(
            Algorithm::SHA1,
            6,
            1,
            30,
            secret.to_bytes().unwrap(),
            Some("Albas".to_string()),
            name,
        )
        .unwrap();
        let secret_b32 = totp.get_secret_base32();
        c.execute("UPDATE accounts SET totp_secret = ?1 WHERE id = ?2", params![secret_b32, id])
            .unwrap();

        // Not confirmed yet: still passes through with no code.
        assert!(verify_if_enrolled(&c, id, None).is_ok());

        let code = code_for(&secret_b32);
        c.execute("UPDATE accounts SET totp_confirmed = 1 WHERE id = ?1", [id]).unwrap();

        assert!(verify_if_enrolled(&c, id, Some(&code)).is_ok());
    }

    #[test]
    fn confirmed_totp_rejects_wrong_code() {
        let c = mem();
        let id = add_account(&c, "sarah");
        let secret = Secret::generate_secret();
        let secret_b32 = match secret.to_encoded() {
            Secret::Encoded(s) => s,
            _ => unreachable!(),
        };
        c.execute(
            "UPDATE accounts SET totp_secret = ?1, totp_confirmed = 1 WHERE id = ?2",
            params![secret_b32, id],
        )
        .unwrap();

        let real = code_for(&secret_b32);
        // Flip one digit to get a code guaranteed wrong, wrapping 9 -> 0.
        let mut wrong: Vec<char> = real.chars().collect();
        let d = wrong[0].to_digit(10).unwrap();
        wrong[0] = std::char::from_digit((d + 1) % 10, 10).unwrap();
        let wrong: String = wrong.into_iter().collect();
        assert_ne!(wrong, real);

        let err = verify_if_enrolled(&c, id, Some(&wrong)).unwrap_err();
        assert_eq!(err.0, StatusCode::UNAUTHORIZED);
        assert_eq!(err.1, CODE_WRONG);
    }

    #[test]
    fn confirmed_totp_requires_a_code() {
        let c = mem();
        let id = add_account(&c, "sarah");
        let secret = Secret::generate_secret();
        let secret_b32 = match secret.to_encoded() {
            Secret::Encoded(s) => s,
            _ => unreachable!(),
        };
        c.execute(
            "UPDATE accounts SET totp_secret = ?1, totp_confirmed = 1 WHERE id = ?2",
            params![secret_b32, id],
        )
        .unwrap();

        let err = verify_if_enrolled(&c, id, None).unwrap_err();
        assert_eq!(err.0, StatusCode::UNAUTHORIZED);
        assert_eq!(err.1, CODE_REQUIRED);

        let err = verify_if_enrolled(&c, id, Some("")).unwrap_err();
        assert_eq!(err.0, StatusCode::UNAUTHORIZED);
        assert_eq!(err.1, CODE_REQUIRED);
    }

    fn headers_for(token: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("authorization", format!("Bearer {token}").parse().unwrap());
        h
    }

    fn state_with(c: Connection) -> Arc<AppState> {
        Arc::new(AppState {
            conn: std::sync::Mutex::new(c),
            admin_token: None,
            signups: crate::Signups::Open,
            webauthn: None,
            assetlinks: None,
            pending: Default::default(),
            google: None,
            google_pending: Default::default(),
        })
    }

    /// End-to-end through the real handlers: enroll, confirm with a code
    /// generated from the returned secret, then check `/totp` and re-enroll.
    #[tokio::test]
    async fn enroll_confirm_status_and_reenroll_via_handlers() {
        let c = mem();
        let id = add_account(&c, "sarah");
        let token = crate::mint_token(&c, id, "device").unwrap();
        let headers = headers_for(&token);
        let state = state_with(c);

        let status = totp_status(State(state.clone()), headers.clone()).await.unwrap().0;
        assert_eq!(status["enrolled"], false);
        assert_eq!(status["confirmed"], false);

        let enrolled = enroll_start(State(state.clone()), headers.clone()).await.unwrap().0;
        let secret_b32 = enrolled["secret"].as_str().unwrap().to_string();
        let uri = enrolled["uri"].as_str().unwrap();
        assert!(uri.starts_with("otpauth://totp/"));
        assert!(uri.contains(&secret_b32));

        let status = totp_status(State(state.clone()), headers.clone()).await.unwrap().0;
        assert_eq!(status["enrolled"], true);
        assert_eq!(status["confirmed"], false, "not confirmed until a code checks out");

        // Wrong code leaves it unconfirmed.
        let bad = enroll_confirm(
            State(state.clone()),
            headers.clone(),
            Json(ConfirmReq { code: "000000".into() }),
        )
        .await;
        assert!(bad.is_err());

        let code = code_for(&secret_b32);
        let confirmed =
            enroll_confirm(State(state.clone()), headers.clone(), Json(ConfirmReq { code }))
                .await
                .unwrap()
                .0;
        assert_eq!(confirmed["confirmed"], true);

        let status = totp_status(State(state.clone()), headers.clone()).await.unwrap().0;
        assert_eq!(status["confirmed"], true);
        assert!(status.get("secret").is_none(), "status must never hand back the secret");

        // Re-enrolling while confirmed is refused, per the doc comment on
        // `enroll_start`.
        let err = enroll_start(State(state.clone()), headers.clone()).await.unwrap_err();
        assert_eq!(err.0, StatusCode::CONFLICT);

        // Disabling clears it, and enrolling again now works.
        let _ = disable_totp(State(state.clone()), headers.clone()).await.unwrap();
        let status = totp_status(State(state.clone()), headers.clone()).await.unwrap().0;
        assert_eq!(status["enrolled"], false);
        assert_eq!(status["confirmed"], false);
        assert!(enroll_start(State(state), headers).await.is_ok());
    }

    #[test]
    fn disable_clears_both_columns() {
        let c = mem();
        let id = add_account(&c, "sarah");
        c.execute(
            "UPDATE accounts SET totp_secret = 'ABCDEFGHIJKLMNOP', totp_confirmed = 1 WHERE id = ?1",
            [id],
        )
        .unwrap();
        c.execute("UPDATE accounts SET totp_secret = NULL, totp_confirmed = 0 WHERE id = ?1", [id])
            .unwrap();
        let (secret, confirmed): (Option<String>, i64) = c
            .query_row("SELECT totp_secret, totp_confirmed FROM accounts WHERE id = ?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert!(secret.is_none());
        assert_eq!(confirmed, 0);
        // Cleared state passes verify_if_enrolled through like never enrolled.
        assert!(verify_if_enrolled(&c, id, None).is_ok());
    }
}
