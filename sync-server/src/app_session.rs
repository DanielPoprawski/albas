//! Handing a browser login back to the desktop/Android app.
//!
//! The app can't read the browser's session: they are separate processes with
//! separate storage. So the app opens the portal with a nonce it generated,
//! and polls until the page reports that someone finished signing in against
//! that nonce.
//!
//! Deliberately poll-based rather than an `albas://` deep link. A custom scheme
//! needs an Android intent filter, an iOS associated-domains entitlement, and a
//! `.desktop` MIME registration that AppImage builds never get — and any app
//! may claim the scheme and receive whatever the URL carries. Polling is the
//! same code on every platform, and a deep link can still be layered on later
//! without changing this contract.
//!
//! Contract:
//!   `POST /app-session`         — unauthenticated. The app opens a pending
//!                                 session; returns `{ nonce, code }`.
//!   `POST /app-session/claim`   — authenticated by the *browser's* bearer
//!                                 token. `{ nonce }` binds it to that account
//!                                 and mints the app's own token.
//!   `GET  /app-session/:nonce`  — unauthenticated, but the nonce is a 256-bit
//!                                 secret. Returns pending / ready / expired,
//!                                 and a ready read consumes the session.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::sync::Arc;

use crate::auth::{mint_token, random_token, token_hash, Authed};
use crate::error::{internal, Rejection};
use crate::{now_ms, AppState};

/// Matches the WebAuthn ceremony TTL in `passkey.rs`. Long enough to pick a
/// password out of a manager, short enough that an abandoned session is not a
/// standing credential.
const TTL_MS: i64 = 5 * 60 * 1000;

/// Hard cap on pending rows, checked (after sweeping expired ones) before
/// `create` inserts another. `app_sessions` has no per-caller identity to
/// rate-limit by — it's the one truly anonymous, unauthenticated write in
/// this server — so without a ceiling a script could grow the table without
/// bound between sweeps. Five minutes' worth of legitimate sign-in attempts
/// is nowhere near this many; hitting it means something is abusing the
/// endpoint, not that real traffic needs more room.
const MAX_PENDING: i64 = 1000;

/// The four characters shown in both the app and the browser so the user can
/// see they are completing *their* login. Derived from the nonce's hash rather
/// than the nonce, so displaying it reveals nothing that helps guess the nonce.
pub(crate) fn confirm_code(nonce_hash: &str) -> String {
    nonce_hash
        .chars()
        .take(4)
        .collect::<String>()
        .to_uppercase()
}

/// Drops sessions past their TTL. Called on every entry point, mirroring the
/// lazy sweep the in-memory ceremony map does — there is no background task.
fn sweep(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM app_sessions WHERE created_at < ?1",
        [now_ms() - TTL_MS],
    )?;
    Ok(())
}

/// Opens a pending session. Unauthenticated by necessity: the app has no
/// credential yet — that is the entire point of the flow.
pub(crate) async fn create(State(state): State<Arc<AppState>>) -> Result<Json<Value>, Rejection> {
    state
        .db(|conn| {
            sweep(conn).map_err(internal)?;

            let pending: i64 = conn
                .query_row("SELECT COUNT(*) FROM app_sessions", [], |r| r.get(0))
                .map_err(internal)?;
            if pending >= MAX_PENDING {
                return Err((
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Too many sign-in requests are pending right now. Try again shortly.".into(),
                ));
            }

            let nonce = random_token();
            let hash = token_hash(&nonce);
            conn.execute(
                "INSERT INTO app_sessions (nonce_hash, created_at) VALUES (?1, ?2)",
                params![hash, now_ms()],
            )
            .map_err(internal)?;

            Ok(Json(json!({ "nonce": nonce, "code": confirm_code(&hash) })))
        })
        .await
}

/// Binds a pending session to the account the browser is signed in as. The
/// bearer token here is the *browser's*; the token minted is the app's, so
/// revoking one later never disturbs the other.
pub(crate) async fn claim(
    State(state): State<Arc<AppState>>,
    auth: Authed,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Rejection> {
    let nonce = body
        .get("nonce")
        .and_then(|v| v.as_str())
        .ok_or((StatusCode::BAD_REQUEST, "A nonce is required.".into()))?
        .to_string();

    state
        .db(move |conn| {
            sweep(conn).map_err(internal)?;
            let account_id = auth.account_id;

            let hash = token_hash(&nonce);
            // Expired and never-existed are the same answer on purpose: the
            // nonce is a secret, and distinguishing them tells a guesser their
            // guess was once real.
            let claimed: Option<Option<i64>> = conn
                .query_row(
                    "SELECT account_id FROM app_sessions WHERE nonce_hash = ?1",
                    [&hash],
                    |r| r.get(0),
                )
                .optional()
                .map_err(internal)?;

            match claimed {
                None => {
                    return Err((
                        StatusCode::NOT_FOUND,
                        "That sign-in request has expired.".into(),
                    ))
                }
                Some(Some(_)) => {
                    return Err((
                        StatusCode::CONFLICT,
                        "That sign-in request was already used.".into(),
                    ))
                }
                Some(None) => {}
            }

            let name: String = conn
                .query_row(
                    "SELECT name FROM accounts WHERE id = ?1",
                    [account_id],
                    |r| r.get(0),
                )
                .map_err(internal)?;

            // Stored in the clear, unavoidably: the app must receive the raw
            // token. Mitigated by the 5-minute TTL and by the single-use
            // delete in `poll`. One transaction, so a minted token can never
            // outlive a failed claim.
            let tx = conn.transaction().map_err(internal)?;
            let token = mint_token(&tx, account_id, "browser").map_err(internal)?;
            tx.execute(
                "UPDATE app_sessions SET account_id = ?1, token = ?2 WHERE nonce_hash = ?3",
                params![account_id, token, hash],
            )
            .map_err(internal)?;
            tx.commit().map_err(internal)?;

            Ok(Json(
                json!({ "code": confirm_code(&hash), "account": name }),
            ))
        })
        .await
}

/// The app's poll. A ready session is consumed by the read, so a leaked nonce
/// cannot be replayed for a second token.
pub(crate) async fn poll(
    State(state): State<Arc<AppState>>,
    Path(nonce): Path<String>,
) -> Result<Json<Value>, Rejection> {
    state
        .db(move |conn| {
            sweep(conn).map_err(internal)?;

            let hash = token_hash(&nonce);
            let row: Option<(Option<i64>, Option<String>)> = conn
                .query_row(
                    "SELECT account_id, token FROM app_sessions WHERE nonce_hash = ?1",
                    [&hash],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(internal)?;

            match row {
                // Swept, never created, or already collected — all "start over".
                None => Ok(Json(json!({ "status": "expired" }))),
                Some((None, _)) => Ok(Json(json!({ "status": "pending" }))),
                Some((Some(account_id), Some(token))) => {
                    conn.execute("DELETE FROM app_sessions WHERE nonce_hash = ?1", [&hash])
                        .map_err(internal)?;
                    let name: String = conn
                        .query_row(
                            "SELECT name FROM accounts WHERE id = ?1",
                            [account_id],
                            |r| r.get(0),
                        )
                        .map_err(internal)?;
                    Ok(Json(
                        json!({ "status": "ready", "token": token, "account": name }),
                    ))
                }
                // account_id set with no token cannot happen: `claim` writes
                // both in one statement. Treat it as pending rather than
                // handing out a half-state.
                Some((Some(_), None)) => Ok(Json(json!({ "status": "pending" }))),
            }
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::State;

    /// Returns (state, the browser's `Authed`).
    fn signed_in() -> (Arc<AppState>, Authed) {
        let c = crate::schema::test_db(None);
        c.execute(
            "INSERT INTO accounts (name, created_at) VALUES ('alice', 0)",
            [],
        )
        .unwrap();
        let id = c.last_insert_rowid();
        let token = mint_token(&c, id, "password").unwrap();
        let auth = Authed {
            account_id: id,
            token_hash: token_hash(&token),
        };
        (Arc::new(AppState::for_test(c)), auth)
    }

    fn browser(auth: &Authed) -> Authed {
        Authed {
            account_id: auth.account_id,
            token_hash: auth.token_hash.clone(),
        }
    }

    async fn open_session(state: &Arc<AppState>) -> (String, String) {
        let v = create(State(state.clone())).await.unwrap().0;
        (
            v["nonce"].as_str().unwrap().to_string(),
            v["code"].as_str().unwrap().to_string(),
        )
    }

    /// The happy path, and the property the app depends on: nothing is handed
    /// out until the browser claims, and then exactly one token is.
    #[tokio::test]
    async fn pending_until_claimed_then_ready() {
        let (state, auth) = signed_in();
        let (nonce, code) = open_session(&state).await;

        let before = poll(State(state.clone()), Path(nonce.clone()))
            .await
            .unwrap()
            .0;
        assert_eq!(before["status"], "pending");
        assert!(before.get("token").is_none());

        let claimed = claim(
            State(state.clone()),
            browser(&auth),
            axum::Json(json!({ "nonce": nonce })),
        )
        .await
        .unwrap()
        .0;
        // Both sides must show the user the same code or it proves nothing.
        assert_eq!(claimed["code"].as_str().unwrap(), code);
        assert_eq!(claimed["account"].as_str().unwrap(), "alice");

        let after = poll(State(state.clone()), Path(nonce)).await.unwrap().0;
        assert_eq!(after["status"], "ready");
        assert_eq!(after["account"].as_str().unwrap(), "alice");
        let app_token = after["token"].as_str().unwrap();
        assert!(!app_token.is_empty());
        // The app's token is its own, not a share of the browser's.
        assert_ne!(token_hash(app_token), auth.token_hash);
    }

    /// A collected session is gone. Without this a leaked nonce would be a
    /// standing credential rather than a one-shot handoff.
    #[tokio::test]
    async fn a_ready_session_cannot_be_collected_twice() {
        let (state, auth) = signed_in();
        let (nonce, _) = open_session(&state).await;
        let _ = claim(
            State(state.clone()),
            browser(&auth),
            axum::Json(json!({ "nonce": nonce })),
        )
        .await
        .unwrap();

        let first = poll(State(state.clone()), Path(nonce.clone()))
            .await
            .unwrap()
            .0;
        assert_eq!(first["status"], "ready");
        let second = poll(State(state.clone()), Path(nonce)).await.unwrap().0;
        assert_eq!(second["status"], "expired");
    }

    /// Two browsers racing the same nonce must not mint two tokens.
    #[tokio::test]
    async fn claiming_twice_is_a_conflict() {
        let (state, auth) = signed_in();
        let (nonce, _) = open_session(&state).await;
        let _ = claim(
            State(state.clone()),
            browser(&auth),
            axum::Json(json!({ "nonce": nonce })),
        )
        .await
        .unwrap();

        let again = claim(
            State(state.clone()),
            browser(&auth),
            axum::Json(json!({ "nonce": nonce })),
        )
        .await;
        assert_eq!(again.unwrap_err().0, StatusCode::CONFLICT);
    }

    /// An abandoned sign-in must not stay claimable overnight.
    #[tokio::test]
    async fn expired_sessions_are_swept() {
        let (state, auth) = signed_in();
        let (nonce, _) = open_session(&state).await;
        {
            let conn = state.conn.lock().unwrap();
            conn.execute(
                "UPDATE app_sessions SET created_at = ?1",
                [now_ms() - TTL_MS - 1],
            )
            .unwrap();
        }

        let polled = poll(State(state.clone()), Path(nonce.clone()))
            .await
            .unwrap()
            .0;
        assert_eq!(polled["status"], "expired");

        let claimed = claim(
            State(state.clone()),
            browser(&auth),
            axum::Json(json!({ "nonce": nonce })),
        )
        .await;
        assert_eq!(claimed.unwrap_err().0, StatusCode::NOT_FOUND);
    }

    /// A guessed nonce reads the same as an expired one, so probing the poll
    /// endpoint never confirms that a nonce was ever real.
    #[tokio::test]
    async fn an_unknown_nonce_looks_expired() {
        let (state, _) = signed_in();
        let v = poll(State(state), Path("not-a-real-nonce".to_string()))
            .await
            .unwrap()
            .0;
        assert_eq!(v["status"], "expired");
    }
}
