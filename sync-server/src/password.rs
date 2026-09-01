//! Password sign-in.
//!
//! The routes are wired in `main.rs` so the module boundary is fixed and the
//! implementing agent touches only this file plus its client counterpart.
//!
//! Contract:
//!   `PUT    /password`       — authenticated by bearer token (`account_for`).
//!                              Sets or changes this account's password.
//!   `DELETE /password`       — authenticated. Removes it.
//!   `POST   /login/password` — unauthenticated. `{ name, password }` in,
//!                              a minted token out, exactly as passkey login
//!                              does via `mint_token`.
//!
//! Hash with the `argon2` crate (Argon2id, PHC string into `accounts.password_hash`).
//! Never reuse `token_hash` — that is a SHA for high-entropy tokens.

use crate::AppState;
use argon2::{
    password_hash::SaltString,
    Argon2, PasswordHasher, PasswordVerifier, PasswordHash,
};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::sync::Arc;

type Rejection = (StatusCode, String);

const MIN_PASSWORD_LENGTH: usize = 12;

/// Whether this account has a password set. Only ever a boolean — the hash is
/// never handed out, and there is nothing else honest to report about a
/// credential the server only stores a verifier for. Settings needs this so the
/// Account & Sign-in table can list a password that really exists rather than
/// guessing from the presence of a "Set password" button.
pub(crate) async fn password_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, Rejection> {
    let conn = state.conn.lock().unwrap();
    let account_id = crate::account_for(&conn, &headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Unauthorized".into()))?;
    let hash: Option<String> = conn
        .query_row("SELECT password_hash FROM accounts WHERE id = ?1", params![account_id], |r| r.get(0))
        .optional()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?
        .flatten();
    Ok(Json(json!({ "set": hash.is_some() })))
}

pub(crate) async fn set_password(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Json<Value>,
) -> Result<Json<Value>, Rejection> {
    let conn = state.conn.lock().unwrap();
    let account_id = crate::account_for(&conn, &headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Unauthorized".into()))?;

    let password = body
        .get("password")
        .and_then(|v| v.as_str())
        .ok_or((StatusCode::BAD_REQUEST, "Missing or invalid 'password' field.".into()))?;

    if password.len() < MIN_PASSWORD_LENGTH {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("Password must be at least {} characters long.", MIN_PASSWORD_LENGTH),
        ));
    }

    // Generate random salt using getrandom
    let mut salt_bytes = [0u8; 16];
    getrandom::getrandom(&mut salt_bytes).expect("OS randomness unavailable");
    let salt = SaltString::encode_b64(&salt_bytes)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Salt error: {}", e)))?;

    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Hash error: {}", e)))?
        .to_string();

    conn.execute(
        "UPDATE accounts SET password_hash = ?1 WHERE id = ?2",
        params![&password_hash, account_id],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?;

    Ok(Json(json!({})))
}

pub(crate) async fn clear_password(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, Rejection> {
    let conn = state.conn.lock().unwrap();
    let account_id = crate::account_for(&conn, &headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Unauthorized".into()))?;

    // Check if the account has at least one passkey before clearing password
    let has_passkey: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM passkeys WHERE account_id = ?1",
            [account_id],
            |row| row.get(0),
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?;

    if !has_passkey {
        return Err((
            StatusCode::CONFLICT,
            "Cannot remove password when no passkeys are set. Add a passkey first.".into(),
        ));
    }

    conn.execute(
        "UPDATE accounts SET password_hash = NULL WHERE id = ?1",
        [account_id],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?;

    Ok(Json(json!({})))
}

pub(crate) async fn login_password(
    State(state): State<Arc<AppState>>,
    body: Json<Value>,
) -> Result<Json<Value>, Rejection> {
    let name = body
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or((StatusCode::BAD_REQUEST, "Missing or invalid 'name' field.".into()))?;

    let password = body
        .get("password")
        .and_then(|v| v.as_str())
        .ok_or((StatusCode::BAD_REQUEST, "Missing or invalid 'password' field.".into()))?;

    let code = body.get("code").and_then(|v| v.as_str());

    let conn = state.conn.lock().unwrap();

    // Look up account by name; use constant-ish time verification
    let account_row: Option<(i64, Option<String>)> = conn
        .query_row(
            "SELECT id, password_hash FROM accounts WHERE name = ?1",
            [name],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?;

    let (account_id, password_hash) = match account_row {
        Some((id, Some(hash))) => (id, hash),
        Some((_, None)) => {
            // Account exists but has no password set; do not leak this difference
            // Verify against a dummy hash to burn the same time
            let _ = PasswordHash::new("$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").ok()
                .and_then(|h| Argon2::default().verify_password(password.as_bytes(), &h).ok());
            return Err((StatusCode::UNAUTHORIZED, "Invalid name or password.".into()));
        }
        None => {
            // Account doesn't exist; do not leak this difference
            // Verify against a dummy hash to burn the same time
            let _ = PasswordHash::new("$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").ok()
                .and_then(|h| Argon2::default().verify_password(password.as_bytes(), &h).ok());
            return Err((StatusCode::UNAUTHORIZED, "Invalid name or password.".into()));
        }
    };

    // Verify password
    let parsed_hash = PasswordHash::new(&password_hash)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Invalid stored hash".into()))?;

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "Invalid name or password.".into()))?;

    // Verify TOTP if enrolled
    crate::totp::verify_if_enrolled(&conn, account_id, code)?;

    // Mint a new token
    let token = crate::mint_token(&conn, account_id, "password")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Token error: {}", e)))?;

    Ok(Json(json!({ "name": name, "token": token })))
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
        c.execute("INSERT INTO accounts (name, created_at) VALUES (?1, 0)", [name])
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

    /// The Account & Sign-in table lists a password only when one exists, so
    /// this boolean is what stops Settings from either hiding a real credential
    /// or inventing one. It must also never echo the hash back.
    #[tokio::test]
    async fn status_reports_whether_a_password_is_set() {
        let c = mem();
        let account_id = add_account(&c, "alice");
        let token = crate::mint_token(&c, account_id, "device").unwrap();
        let state = Arc::new(AppState {
            conn: std::sync::Mutex::new(c),
            admin_token: None,
            signups: crate::Signups::Open,
            webauthn: None,
            assetlinks: None,
            pending: Default::default(),
            google: None,
            google_pending: Default::default(),
        });

        let before = password_status(axum::extract::State(state.clone()), headers_for(&token))
            .await
            .unwrap()
            .0;
        assert_eq!(before["set"], serde_json::Value::Bool(false));

        set_password(
            axum::extract::State(state.clone()),
            headers_for(&token),
            Json(json!({ "password": "MyVerySecurePassword123" })),
        )
        .await
        .unwrap();

        let after = password_status(axum::extract::State(state.clone()), headers_for(&token))
            .await
            .unwrap()
            .0;
        assert_eq!(after["set"], serde_json::Value::Bool(true));
        // The verifier itself must never leave the server.
        assert!(!after.to_string().contains("$argon2"));

        // An unknown token learns nothing.
        let anon = password_status(axum::extract::State(state), headers_for("nope")).await;
        assert_eq!(anon.unwrap_err().0, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn set_then_login_password() {
        let c = mem();
        let account_id = add_account(&c, "alice");
        let token = crate::mint_token(&c, account_id, "device").unwrap();
        let headers = headers_for(&token);
        let password = "MyVerySecurePassword123";

        // Set a password
        let state = Arc::new(AppState {
            conn: std::sync::Mutex::new(c),
            admin_token: None,
            signups: crate::Signups::Open,
            webauthn: None,
            assetlinks: None,
            pending: Default::default(),
            google: None,
            google_pending: Default::default(),
        });

        let body = Json(json!({ "password": password }));
        let result = set_password(axum::extract::State(state.clone()), headers, body).await;
        assert!(result.is_ok());

        // Login with the password
        let login_body = Json(json!({ "name": "alice", "password": password }));
        let result = login_password(axum::extract::State(state), login_body).await;
        assert!(result.is_ok());
        let response = result.unwrap().0;
        assert_eq!(response["name"], "alice");
        assert!(!response["token"].as_str().unwrap().is_empty());
    }

    #[tokio::test]
    async fn wrong_password_rejected() {
        let c = mem();
        let account_id = add_account(&c, "bob");
        let token = crate::mint_token(&c, account_id, "device").unwrap();
        let headers = headers_for(&token);

        let state = Arc::new(AppState {
            conn: std::sync::Mutex::new(c),
            admin_token: None,
            signups: crate::Signups::Open,
            webauthn: None,
            assetlinks: None,
            pending: Default::default(),
            google: None,
            google_pending: Default::default(),
        });

        // Set a password
        let body = Json(json!({ "password": "CorrectPassword123" }));
        let _ = set_password(axum::extract::State(state.clone()), headers, body).await;

        // Try wrong password
        let login_body = Json(json!({ "name": "bob", "password": "WrongPassword123" }));
        let result = login_password(axum::extract::State(state), login_body).await;
        assert!(result.is_err());
        let (status, msg) = result.unwrap_err();
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(msg, "Invalid name or password.");
    }

    #[tokio::test]
    async fn unknown_account_same_rejection() {
        let c = mem();
        let _ = add_account(&c, "alice");

        let state = Arc::new(AppState {
            conn: std::sync::Mutex::new(c),
            admin_token: None,
            signups: crate::Signups::Open,
            webauthn: None,
            assetlinks: None,
            pending: Default::default(),
            google: None,
            google_pending: Default::default(),
        });

        // Try to login to non-existent account
        let login_body = Json(json!({ "name": "eve", "password": "SomePassword123" }));
        let result = login_password(axum::extract::State(state), login_body).await;
        assert!(result.is_err());
        let (status, msg) = result.unwrap_err();
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(msg, "Invalid name or password.");
    }

    #[tokio::test]
    async fn clear_password_refused_without_passkey() {
        let c = mem();
        let account_id = add_account(&c, "charlie");
        let token = crate::mint_token(&c, account_id, "device").unwrap();
        let headers = headers_for(&token);

        let state = Arc::new(AppState {
            conn: std::sync::Mutex::new(c),
            admin_token: None,
            signups: crate::Signups::Open,
            webauthn: None,
            assetlinks: None,
            pending: Default::default(),
            google: None,
            google_pending: Default::default(),
        });

        // Set a password
        let body = Json(json!({ "password": "MyPassword123" }));
        let _ = set_password(axum::extract::State(state.clone()), headers.clone(), body).await;

        // Try to clear without a passkey
        let result = clear_password(axum::extract::State(state), headers).await;
        assert!(result.is_err());
        let (status, msg) = result.unwrap_err();
        assert_eq!(status, StatusCode::CONFLICT);
        assert!(msg.contains("Cannot remove password"));
    }

    #[tokio::test]
    async fn clear_password_succeeds_with_passkey() {
        let c = mem();
        let account_id = add_account(&c, "diana");
        add_passkey(&c, account_id, "cred-1");
        let token = crate::mint_token(&c, account_id, "device").unwrap();
        let headers = headers_for(&token);

        let state = Arc::new(AppState {
            conn: std::sync::Mutex::new(c),
            admin_token: None,
            signups: crate::Signups::Open,
            webauthn: None,
            assetlinks: None,
            pending: Default::default(),
            google: None,
            google_pending: Default::default(),
        });

        // Set a password
        let body = Json(json!({ "password": "MyPassword123" }));
        let _ = set_password(axum::extract::State(state.clone()), headers.clone(), body).await;

        // Clear the password (should succeed because we have a passkey)
        let result = clear_password(axum::extract::State(state), headers).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn password_too_short_rejected() {
        let c = mem();
        let account_id = add_account(&c, "eve");
        let token = crate::mint_token(&c, account_id, "device").unwrap();
        let headers = headers_for(&token);

        let state = Arc::new(AppState {
            conn: std::sync::Mutex::new(c),
            admin_token: None,
            signups: crate::Signups::Open,
            webauthn: None,
            assetlinks: None,
            pending: Default::default(),
            google: None,
            google_pending: Default::default(),
        });

        // Try to set a short password
        let body = Json(json!({ "password": "short" }));
        let result = set_password(axum::extract::State(state), headers, body).await;
        assert!(result.is_err());
        let (status, msg) = result.unwrap_err();
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(msg.contains("at least"));
        assert!(msg.contains("characters"));
    }
}
