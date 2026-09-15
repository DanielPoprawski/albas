//! Password sign-in.
//!
//! Contract:
//!   `GET    /password`       — authenticated. `{ set: bool }`, never the hash.
//!   `PUT    /password`       — authenticated. Sets or changes this account's
//!                              password.
//!   `DELETE /password`       — authenticated. Removes it, if a passkey remains.
//!   `POST   /login/password` — unauthenticated. `{ name, password, code? }`
//!                              in, a minted token out, exactly as passkey
//!                              login does via `mint_token`. A confirmed TOTP
//!                              with no `code` answers 428 so a client can ask
//!                              for the code instead of reporting a bad password.
//!   `POST   /register/password` — unauthenticated. `{ name, password, invite? }`
//!                              creates the account (same signup/invite matrix
//!                              as passkey registration) and mints a token.
//!                              A password is the mandatory first credential;
//!                              passkeys and TOTP are added afterwards.
//!
//! Hashing is the `argon2` crate (Argon2id, PHC string into
//! `accounts.password_hash`). Never reuse `token_hash` for this — that is a
//! SHA for high-entropy tokens. Every verify runs inside `AppState::db`, so
//! the ~100 ms an Argon2 check costs lands on the blocking pool, not on an
//! async worker.

use argon2::{password_hash::SaltString, Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{extract::State, http::StatusCode, Json};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::sync::Arc;

use crate::auth::{mint_token, Authed};
use crate::error::{internal, Rejection};
use crate::{lockout, now_ms, passkey, totp, AppState};

const MIN_PASSWORD_LENGTH: usize = 12;
/// Mirrors `MAX_PASSWORD_LENGTH` in `shared/authRules.ts`. Argon2 hashes the
/// whole input, so an unbounded password is a cheap way to burn CPU here.
const MAX_PASSWORD_LENGTH: usize = 128;

/// A PHC string that never matches, verified against when the account does
/// not exist or has no password, so those answers take as long as a wrong
/// password does.
const DUMMY_HASH: &str =
    "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const INVALID_LOGIN: &str = "Invalid name or password.";

fn field<'a>(body: &'a Value, name: &str) -> Result<&'a str, Rejection> {
    body.get(name).and_then(|v| v.as_str()).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            format!("Missing or invalid '{name}' field."),
        )
    })
}

/// Whether this account has a password set. Only ever a boolean — the hash is
/// never handed out, and there is nothing else honest to report about a
/// credential the server only stores a verifier for. Settings needs this so the
/// Account & Sign-in table can list a password that really exists rather than
/// guessing from the presence of a "Set password" button.
pub(crate) async fn password_status(
    State(state): State<Arc<AppState>>,
    auth: Authed,
) -> Result<Json<Value>, Rejection> {
    state
        .db(move |conn| {
            let hash = stored_hash(conn, auth.account_id)?;
            Ok(Json(json!({ "set": hash.is_some() })))
        })
        .await
}

fn stored_hash(conn: &Connection, account_id: i64) -> Result<Option<String>, Rejection> {
    Ok(conn
        .query_row(
            "SELECT password_hash FROM accounts WHERE id = ?1",
            params![account_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(internal)?
        .flatten())
}

/// Argon2id PHC string for `accounts.password_hash`, after the length check.
pub(crate) fn hash_password(password: &str) -> Result<String, Rejection> {
    if password.len() < MIN_PASSWORD_LENGTH {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("Password must be at least {MIN_PASSWORD_LENGTH} characters long."),
        ));
    }
    if password.len() > MAX_PASSWORD_LENGTH {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("Password must be at most {MAX_PASSWORD_LENGTH} characters long."),
        ));
    }
    let mut salt_bytes = [0u8; 16];
    getrandom::getrandom(&mut salt_bytes).expect("OS randomness unavailable");
    let salt = SaltString::encode_b64(&salt_bytes).map_err(internal)?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(internal)
}

fn verify(password: &str, phc: &str) -> Result<bool, Rejection> {
    let parsed = PasswordHash::new(phc).map_err(|e| internal(format!("stored hash: {e}")))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

/// Creates an account with a password as its first credential. Reuses the
/// passkey registration's `resolve_registration` so invites, invite-only
/// servers and name rules behave identically; an invite pinned to an existing
/// name sets that account's password instead (the bootstrap path).
pub(crate) async fn register_password(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Rejection> {
    let name = field(&body, "name")?.to_string();
    let password = field(&body, "password")?.to_string();
    let invite = body
        .get("invite")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string);
    let signups = state.signups;

    state
        .db(move |conn| {
            let password_hash = hash_password(&password)?;
            let info = passkey::resolve_registration(conn, signups, invite.as_deref(), &name)?;

            let tx = conn.transaction().map_err(internal)?;
            if let Some(invite_id) = info.invite_id {
                let burned = tx
                    .execute(
                        "UPDATE invites SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL",
                        params![now_ms(), invite_id],
                    )
                    .map_err(internal)?;
                if burned == 0 {
                    return Err((
                        StatusCode::GONE,
                        "This invite has already been used.".into(),
                    ));
                }
            }
            let account_id = match info.account_id {
                Some(id) => {
                    tx.execute(
                        "UPDATE accounts SET password_hash = ?1 WHERE id = ?2",
                        params![&password_hash, id],
                    )
                    .map_err(internal)?;
                    id
                }
                None => match tx.execute(
                    "INSERT INTO accounts (name, created_at, password_hash) VALUES (?1, ?2, ?3)",
                    params![info.name, now_ms(), &password_hash],
                ) {
                    Ok(_) => tx.last_insert_rowid(),
                    Err(rusqlite::Error::SqliteFailure(e, _))
                        if e.code == rusqlite::ErrorCode::ConstraintViolation =>
                    {
                        return Err((StatusCode::CONFLICT, "That account name is taken.".into()))
                    }
                    Err(e) => return Err(internal(e)),
                },
            };
            let token = mint_token(&tx, account_id, "password").map_err(internal)?;
            tx.commit().map_err(internal)?;

            Ok(Json(json!({ "name": info.name, "token": token })))
        })
        .await
}

pub(crate) async fn set_password(
    State(state): State<Arc<AppState>>,
    auth: Authed,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Rejection> {
    let password = field(&body, "password")?.to_string();
    state
        .db(move |conn| {
            let password_hash = hash_password(&password)?;
            conn.execute(
                "UPDATE accounts SET password_hash = ?1 WHERE id = ?2",
                params![&password_hash, auth.account_id],
            )
            .map_err(internal)?;
            Ok(Json(json!({})))
        })
        .await
}

/// Refused while the account has no passkey: the password is then its only
/// credential, and clearing it would leave nothing that can mint a token.
pub(crate) async fn clear_password(
    State(state): State<Arc<AppState>>,
    auth: Authed,
) -> Result<Json<Value>, Rejection> {
    state
        .db(move |conn| {
            let has_passkey: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM passkeys WHERE account_id = ?1",
                    [auth.account_id],
                    |row| row.get(0),
                )
                .map_err(internal)?;
            if !has_passkey {
                return Err((
                    StatusCode::CONFLICT,
                    "Cannot remove password when no passkeys are set. Add a passkey first.".into(),
                ));
            }
            conn.execute(
                "UPDATE accounts SET password_hash = NULL WHERE id = ?1",
                [auth.account_id],
            )
            .map_err(internal)?;
            Ok(Json(json!({})))
        })
        .await
}

pub(crate) async fn login_password(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Rejection> {
    let name = field(&body, "name")?.to_string();
    let password = field(&body, "password")?.to_string();
    let code = body
        .get("code")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let recovery_code = body
        .get("recovery_code")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let kek = state.kek;

    state
        .db(move |conn| {
            let account_row: Option<(i64, Option<String>)> = conn
                .query_row(
                    "SELECT id, password_hash FROM accounts WHERE name = ?1",
                    [&name],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(internal)?;

            // An unknown name and an account with no password answer the same
            // way, after the same Argon2 work, as a wrong password does.
            let (account_id, password_hash) = match account_row {
                Some((id, Some(hash))) => (id, hash),
                _ => {
                    let _ = verify(&password, DUMMY_HASH);
                    return Err((StatusCode::UNAUTHORIZED, INVALID_LOGIN.into()));
                }
            };

            // Per-account lockout, checked before spending an Argon2 verify — a
            // locked account answers 423 regardless of whether this attempt's
            // password would have been right.
            lockout::check(conn, account_id, "password")?;

            if !verify(&password, &password_hash)? {
                lockout::record_failure(conn, account_id, "password")?;
                return Err((StatusCode::UNAUTHORIZED, INVALID_LOGIN.into()));
            }

            // Verify TOTP if enrolled — either a code or, in its place, a
            // one-time recovery code. "Code missing" gets its own status so a
            // client can reveal the code field rather than telling the user
            // their password was wrong. Its own lockout ("totp") is enforced
            // inside `verify_if_enrolled`.
            totp::verify_if_enrolled(
                conn,
                kek,
                account_id,
                code.as_deref(),
                recovery_code.as_deref(),
            )
            .map_err(|(status, msg)| {
                if msg == totp::CODE_REQUIRED {
                    (StatusCode::PRECONDITION_REQUIRED, msg)
                } else {
                    (status, msg)
                }
            })?;

            lockout::reset(conn, account_id, "password")?;

            let token = mint_token(conn, account_id, "password").map_err(internal)?;
            Ok(Json(json!({ "name": name, "token": token })))
        })
        .await
}

/// Re-verifies the signed-in account's current password against a freshly
/// supplied one — the "prove you're still you" step before a sensitive
/// action (enrolling TOTP, deleting the account) rather than trusting a
/// bearer token alone, which could be a stolen session rather than the
/// account holder at the keyboard.
pub(crate) fn verify_account_password(
    conn: &Connection,
    account_id: i64,
    password: &str,
) -> Result<(), Rejection> {
    let Some(hash) = stored_hash(conn, account_id)? else {
        return Err((
            StatusCode::CONFLICT,
            "Set a password on this account first.".into(),
        ));
    };
    if verify(password, &hash)? {
        Ok(())
    } else {
        Err((StatusCode::UNAUTHORIZED, "Incorrect password.".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{account_for, token_hash};
    use axum::extract::State;
    use axum::http::HeaderMap;

    fn add_account(c: &Connection, name: &str) -> i64 {
        c.execute(
            "INSERT INTO accounts (name, created_at) VALUES (?1, 0)",
            [name],
        )
        .unwrap();
        c.last_insert_rowid()
    }

    fn headers_for(token: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("authorization", format!("Bearer {token}").parse().unwrap());
        h
    }

    fn add_passkey(c: &Connection, account_id: i64, cred_id: &str) {
        c.execute(
            "INSERT INTO passkeys (account_id, cred_id, passkey_json, created_at) VALUES (?1, ?2, '{}', 0)",
            params![account_id, cred_id],
        )
        .unwrap();
    }

    /// A signed-in account: (state, its `Authed`).
    fn signed_in(name: &str) -> (Arc<AppState>, Authed) {
        let c = crate::schema::test_db(None);
        let account_id = add_account(&c, name);
        let token = mint_token(&c, account_id, "device").unwrap();
        let auth = Authed {
            account_id,
            token_hash: token_hash(&token),
        };
        (Arc::new(AppState::for_test(c)), auth)
    }

    fn again(auth: &Authed) -> Authed {
        Authed {
            account_id: auth.account_id,
            token_hash: auth.token_hash.clone(),
        }
    }

    async fn set(state: &Arc<AppState>, auth: &Authed, password: &str) -> Result<Value, Rejection> {
        set_password(
            State(state.clone()),
            again(auth),
            Json(json!({ "password": password })),
        )
        .await
        .map(|j| j.0)
    }

    async fn login(state: &Arc<AppState>, body: Value) -> Result<Value, Rejection> {
        login_password(State(state.clone()), Json(body))
            .await
            .map(|j| j.0)
    }

    /// The Account & Sign-in table lists a password only when one exists, so
    /// this boolean is what stops Settings from either hiding a real credential
    /// or inventing one. It must also never echo the hash back.
    #[tokio::test]
    async fn status_reports_whether_a_password_is_set() {
        let (state, auth) = signed_in("alice");

        let before = password_status(State(state.clone()), again(&auth))
            .await
            .unwrap()
            .0;
        assert_eq!(before["set"], Value::Bool(false));

        set(&state, &auth, "MyVerySecurePassword123").await.unwrap();

        let after = password_status(State(state.clone()), again(&auth))
            .await
            .unwrap()
            .0;
        assert_eq!(after["set"], Value::Bool(true));
        // The verifier itself must never leave the server.
        assert!(!after.to_string().contains("$argon2"));
    }

    #[tokio::test]
    async fn set_then_login_password() {
        let (state, auth) = signed_in("alice");
        let password = "MyVerySecurePassword123";
        set(&state, &auth, password).await.unwrap();

        let response = login(&state, json!({ "name": "alice", "password": password }))
            .await
            .unwrap();
        assert_eq!(response["name"], "alice");
        assert!(!response["token"].as_str().unwrap().is_empty());
    }

    #[tokio::test]
    async fn wrong_password_rejected() {
        let (state, auth) = signed_in("bob");
        set(&state, &auth, "CorrectPassword123").await.unwrap();

        let (status, msg) = login(
            &state,
            json!({ "name": "bob", "password": "WrongPassword123" }),
        )
        .await
        .unwrap_err();
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(msg, INVALID_LOGIN);
    }

    #[tokio::test]
    async fn unknown_account_same_rejection() {
        let (state, _) = signed_in("alice");
        let (status, msg) = login(
            &state,
            json!({ "name": "eve", "password": "SomePassword123" }),
        )
        .await
        .unwrap_err();
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(msg, INVALID_LOGIN);
    }

    #[tokio::test]
    async fn clear_password_refused_without_passkey() {
        let (state, auth) = signed_in("charlie");
        set(&state, &auth, "MyPassword123").await.unwrap();

        let (status, msg) = clear_password(State(state.clone()), again(&auth))
            .await
            .unwrap_err();
        assert_eq!(status, StatusCode::CONFLICT);
        assert!(msg.contains("Cannot remove password"));
    }

    #[tokio::test]
    async fn clear_password_succeeds_with_passkey() {
        let (state, auth) = signed_in("diana");
        {
            let c = state.conn.lock().unwrap();
            add_passkey(&c, auth.account_id, "cred-1");
        }
        set(&state, &auth, "MyPassword123").await.unwrap();
        assert!(clear_password(State(state.clone()), again(&auth))
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn password_too_short_rejected() {
        let (state, auth) = signed_in("eve");
        let (status, msg) = set(&state, &auth, "short").await.unwrap_err();
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(msg.contains("at least"));
        assert!(msg.contains("characters"));
    }

    /// Password-first signup: the account exists afterwards with a working
    /// password, the token it minted resolves, and the name can't be reused.
    #[tokio::test]
    async fn register_then_login_round_trip_and_duplicate_name_conflicts() {
        let state = Arc::new(AppState::for_test(crate::schema::test_db(None)));
        let body = json!({ "name": "bob", "password": "CorrectHorseBattery1" });
        let created = register_password(State(state.clone()), Json(body.clone()))
            .await
            .unwrap()
            .0;
        assert_eq!(created["name"], "bob");
        let token = created["token"].as_str().unwrap().to_string();
        {
            let c = state.conn.lock().unwrap();
            assert!(account_for(&c, &headers_for(&token)).is_some());
        }

        let again = register_password(State(state.clone()), Json(body)).await;
        assert_eq!(again.unwrap_err().0, StatusCode::CONFLICT);

        let login_res = login(
            &state,
            json!({ "name": "bob", "password": "CorrectHorseBattery1" }),
        )
        .await
        .unwrap();
        assert_eq!(login_res["name"], "bob");
        assert!(login_res["token"].as_str().is_some());

        let wrong = login(
            &state,
            json!({ "name": "bob", "password": "not-it-not-it-1" }),
        )
        .await;
        assert_eq!(wrong.unwrap_err().0, StatusCode::UNAUTHORIZED);

        let short = register_password(
            State(state),
            Json(json!({ "name": "carol", "password": "short" })),
        )
        .await;
        assert_eq!(short.unwrap_err().0, StatusCode::UNPROCESSABLE_ENTITY);
    }

    /// The 428 the clients key on: a confirmed TOTP and a right password with
    /// no code must not read as a wrong password.
    #[tokio::test]
    async fn login_answers_428_when_a_code_is_required() {
        let (state, auth) = signed_in("tess");
        let state = Arc::new(AppState {
            kek: Some(totp::tests::KEK),
            ..Arc::try_unwrap(state).ok().unwrap()
        });
        set(&state, &auth, "CorrectHorseBattery1").await.unwrap();
        let secret = totp::tests::fresh_secret();
        {
            let c = state.conn.lock().unwrap();
            totp::tests::enroll_confirmed(&c, auth.account_id, &secret);
        }

        let err = login(
            &state,
            json!({ "name": "tess", "password": "CorrectHorseBattery1" }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, StatusCode::PRECONDITION_REQUIRED);
        assert_eq!(err.1, totp::CODE_REQUIRED);

        let wrong = login(
            &state,
            json!({ "name": "tess", "password": "CorrectHorseBattery1", "code": "000000" }),
        )
        .await
        .unwrap_err();
        assert_eq!(wrong.0, StatusCode::UNAUTHORIZED);

        let code = totp::tests::code_for(&secret);
        let ok = login(
            &state,
            json!({ "name": "tess", "password": "CorrectHorseBattery1", "code": code }),
        )
        .await
        .unwrap();
        assert_eq!(ok["name"], "tess");
    }
}
