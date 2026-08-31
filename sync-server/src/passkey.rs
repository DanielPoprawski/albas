//! Passkey (WebAuthn) registration and login, plus the invite system.
//!
//! The ceremonies run *in the Albas app* via `tauri-plugin-webauthn`, which
//! speaks the same `webauthn-rs-proto` wire types this server emits — the app
//! relays `options` to the platform authenticator and posts the credential
//! back. Login is discoverable (usernameless): the authenticator tells us which
//! credential it used and we look the account up by credential id, so the
//! registration-time user id is a throwaway.
//!
//! Signups are open by default (`ALBAS_SYNC_SIGNUPS=invite` locks them down).
//! Invites exist for two cases: locked-down servers, and attaching a passkey to
//! an account that already exists — that one always demands an invite naming
//! the exact account, otherwise anyone could bind their key to your data.
//!
//! Pending ceremony states live in memory (single process); every access
//! sweeps expired entries, so there is no background task.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use webauthn_rs::prelude::*;

use crate::{admin_ok, mint_token, name_ok, now_ms, random_token, token_hash, AppState, Signups};

const REG_TTL_MS: i64 = 5 * 60 * 1000;
const AUTH_TTL_MS: i64 = 5 * 60 * 1000;
const INVITE_TTL_MS: i64 = 7 * 24 * 60 * 60 * 1000;

type Rejection = (StatusCode, String);

/// What a registration ceremony will do once the credential comes back.
#[derive(Debug)]
pub(crate) struct RegInfo {
    pub(crate) name: String,
    pub(crate) invite_id: Option<i64>,
    /// `Some` = attach a new passkey to this existing account; `None` = create.
    pub(crate) account_id: Option<i64>,
}

struct PendingReg {
    info: RegInfo,
    state: PasskeyRegistration,
    expires_at: i64,
}

struct PendingAuth {
    state: DiscoverableAuthentication,
    expires_at: i64,
}

#[derive(Default)]
pub(crate) struct Pending {
    regs: Mutex<HashMap<String, PendingReg>>,
    auths: Mutex<HashMap<String, PendingAuth>>,
}

impl Pending {
    fn put_reg(&self, id: String, info: RegInfo, state: PasskeyRegistration) {
        let mut m = self.regs.lock().unwrap();
        let now = now_ms();
        m.retain(|_, v| v.expires_at > now);
        m.insert(id, PendingReg { info, state, expires_at: now + REG_TTL_MS });
    }
    fn take_reg(&self, id: &str) -> Option<(RegInfo, PasskeyRegistration)> {
        let mut m = self.regs.lock().unwrap();
        let now = now_ms();
        m.retain(|_, v| v.expires_at > now);
        m.remove(id).map(|p| (p.info, p.state))
    }
    fn put_auth(&self, id: String, state: DiscoverableAuthentication) {
        let mut m = self.auths.lock().unwrap();
        let now = now_ms();
        m.retain(|_, v| v.expires_at > now);
        m.insert(id, PendingAuth { state, expires_at: now + AUTH_TTL_MS });
    }
    fn take_auth(&self, id: &str) -> Option<DiscoverableAuthentication> {
        let mut m = self.auths.lock().unwrap();
        let now = now_ms();
        m.retain(|_, v| v.expires_at > now);
        m.remove(id).map(|p| p.state)
    }
}

/// Builds the `Webauthn` verifier from `ALBAS_SYNC_ORIGIN` (the public URL the
/// relying-party id is derived from). `ALBAS_SYNC_ANDROID_ORIGIN` additionally
/// allows the `android:apk-key-hash:…` origin that Android's Credential
/// Manager asserts instead of an https origin. Unset origin = passkeys off.
pub(crate) fn build_webauthn() -> Result<Option<Webauthn>, String> {
    let Some(origin) = std::env::var("ALBAS_SYNC_ORIGIN").ok().filter(|s| !s.trim().is_empty())
    else {
        return Ok(None);
    };
    let url = Url::parse(origin.trim()).map_err(|e| format!("ALBAS_SYNC_ORIGIN invalid: {e}"))?;
    let rp_id = url
        .host_str()
        .ok_or("ALBAS_SYNC_ORIGIN has no host")?
        .to_string();
    let mut builder = WebauthnBuilder::new(&rp_id, &url)
        .map_err(|e| format!("ALBAS_SYNC_ORIGIN rejected: {e:?}"))?
        .rp_name("Albas");
    if let Some(android) =
        std::env::var("ALBAS_SYNC_ANDROID_ORIGIN").ok().filter(|s| !s.trim().is_empty())
    {
        let au = Url::parse(android.trim())
            .map_err(|e| format!("ALBAS_SYNC_ANDROID_ORIGIN invalid: {e}"))?;
        builder = builder.append_allowed_origin(&au);
    }
    builder.build().map(Some).map_err(|e| format!("webauthn setup failed: {e:?}"))
}

fn webauthn_of(state: &AppState) -> Result<&Webauthn, Rejection> {
    state.webauthn.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "Passkeys are not configured on this server (ALBAS_SYNC_ORIGIN is unset).".into(),
    ))
}

fn internal<E: std::fmt::Display>(e: E) -> Rejection {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

fn random_uuid() -> Uuid {
    let mut buf = [0u8; 16];
    getrandom::getrandom(&mut buf).expect("OS randomness unavailable");
    Uuid::from_bytes(buf)
}

/// Decides what a registration attempt is allowed to do, before any ceremony
/// starts. Pure database logic so the signup/invite/attach matrix is testable.
pub(crate) fn resolve_registration(
    conn: &Connection,
    signups: Signups,
    invite_code: Option<&str>,
    requested_name: &str,
) -> Result<RegInfo, Rejection> {
    let invite = match invite_code {
        Some(code) => {
            let row: Option<(i64, Option<String>, i64, Option<i64>)> = conn
                .query_row(
                    "SELECT id, name, expires_at, used_at FROM invites WHERE code_hash = ?1",
                    [token_hash(code)],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .optional()
                .map_err(internal)?;
            let Some((id, name, expires_at, used_at)) = row else {
                return Err((StatusCode::NOT_FOUND, "Unknown invite code.".into()));
            };
            if used_at.is_some() {
                return Err((StatusCode::GONE, "This invite has already been used.".into()));
            }
            if expires_at < now_ms() {
                return Err((StatusCode::GONE, "This invite has expired.".into()));
            }
            Some((id, name))
        }
        None => None,
    };

    // An invite minted for a specific name pins the name.
    let name = match &invite {
        Some((_, Some(pinned))) => pinned.clone(),
        _ => requested_name.trim().to_string(),
    };
    if !name_ok(&name) {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "Account names are 1-64 characters: letters, digits, '-' or '_'.".into(),
        ));
    }

    let existing: Option<i64> = conn
        .query_row("SELECT id FROM accounts WHERE name = ?1", [&name], |r| r.get(0))
        .optional()
        .map_err(internal)?;

    match existing {
        // Attaching a passkey to an existing account demands an invite pinned
        // to that exact name — otherwise open signup would let anyone claim it.
        Some(id) => match &invite {
            Some((invite_id, Some(pinned))) if *pinned == name => {
                Ok(RegInfo { name, invite_id: Some(*invite_id), account_id: Some(id) })
            }
            _ => Err((StatusCode::CONFLICT, "That account name is taken.".into())),
        },
        None => {
            if invite.is_none() && state_requires_invite(signups) {
                return Err((
                    StatusCode::FORBIDDEN,
                    "Registration on this server requires an invite.".into(),
                ));
            }
            Ok(RegInfo { name, invite_id: invite.map(|(id, _)| id), account_id: None })
        }
    }
}

fn state_requires_invite(signups: Signups) -> bool {
    signups == Signups::InviteOnly
}

/// The write half of registration, after the ceremony verified: burn the
/// invite, create or reuse the account, store the passkey, mint a token. One
/// transaction so a name race or replayed invite can't half-apply.
pub(crate) fn complete_registration(
    conn: &mut Connection,
    info: &RegInfo,
    cred_id_hex: &str,
    passkey_json: &str,
    label: &str,
) -> Result<(String, String), Rejection> {
    let tx = conn.transaction().map_err(internal)?;
    if let Some(invite_id) = info.invite_id {
        let burned = tx
            .execute(
                "UPDATE invites SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL",
                params![now_ms(), invite_id],
            )
            .map_err(internal)?;
        if burned == 0 {
            return Err((StatusCode::GONE, "This invite has already been used.".into()));
        }
    }
    let account_id = match info.account_id {
        Some(id) => id,
        None => {
            match tx.execute(
                "INSERT INTO accounts (name, created_at) VALUES (?1, ?2)",
                params![info.name, now_ms()],
            ) {
                Ok(_) => tx.last_insert_rowid(),
                Err(rusqlite::Error::SqliteFailure(e, _))
                    if e.code == rusqlite::ErrorCode::ConstraintViolation =>
                {
                    return Err((StatusCode::CONFLICT, "That account name is taken.".into()))
                }
                Err(e) => return Err(internal(e)),
            }
        }
    };
    tx.execute(
        "INSERT INTO passkeys (account_id, cred_id, passkey_json, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![account_id, cred_id_hex, passkey_json, now_ms()],
    )
    .map_err(internal)?;
    let token = mint_token(&tx, account_id, label).map_err(internal)?;
    tx.commit().map_err(internal)?;
    Ok((info.name.clone(), token))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterStartReq {
    name: String,
    #[serde(default)]
    invite: Option<String>,
}

pub(crate) async fn register_start(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RegisterStartReq>,
) -> Result<Json<Value>, Rejection> {
    let webauthn = webauthn_of(&state)?;
    let info = {
        let guard = state.conn.lock().map_err(internal)?;
        resolve_registration(&guard, state.signups, req.invite.as_deref(), &req.name)?
    };
    let (options, reg_state) = webauthn
        .start_passkey_registration(random_uuid(), &info.name, &info.name, None)
        .map_err(|e| internal(format!("could not start registration: {e:?}")))?;
    let reg_id = random_token();
    state.pending.put_reg(reg_id.clone(), info, reg_state);
    Ok(Json(json!({ "regId": reg_id, "options": options })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterFinishReq {
    reg_id: String,
    #[serde(default)]
    label: Option<String>,
    credential: RegisterPublicKeyCredential,
}

pub(crate) async fn register_finish(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RegisterFinishReq>,
) -> Result<Json<Value>, Rejection> {
    let webauthn = webauthn_of(&state)?;
    let (info, reg_state) = state.pending.take_reg(&req.reg_id).ok_or((
        StatusCode::GONE,
        "This registration attempt expired — start again.".into(),
    ))?;
    let passkey = webauthn
        .finish_passkey_registration(&req.credential, &reg_state)
        .map_err(|e| (StatusCode::UNAUTHORIZED, format!("registration rejected: {e:?}")))?;
    let cred_id_hex = crate::to_hex(passkey.cred_id().as_ref());
    let passkey_json = serde_json::to_string(&passkey).map_err(internal)?;
    let label = req.label.as_deref().unwrap_or("passkey");

    let mut guard = state.conn.lock().map_err(internal)?;
    let (name, token) =
        complete_registration(&mut guard, &info, &cred_id_hex, &passkey_json, label)?;
    Ok(Json(json!({ "name": name, "token": token })))
}

// ---------------------------------------------------------------------------
// Self-service: adding another passkey to the account you are already signed
// into. The invite path above stays — it is the only way to attach a key to an
// account you cannot already open. This one is authenticated by the same
// bearer token `/sync` uses, so no admin is involved.
// ---------------------------------------------------------------------------

fn unauthorized() -> Rejection {
    (StatusCode::UNAUTHORIZED, "Not signed in.".into())
}

/// The account behind the presented bearer token, plus its name.
fn signed_in(conn: &Connection, headers: &HeaderMap) -> Result<(i64, String), Rejection> {
    let account_id = crate::account_for(conn, headers).ok_or_else(unauthorized)?;
    let name: String = conn
        .query_row("SELECT name FROM accounts WHERE id = ?1", [account_id], |r| r.get(0))
        .optional()
        .map_err(internal)?
        .ok_or_else(unauthorized)?;
    Ok((account_id, name))
}

/// Credential ids already on the account, read back out of the stored
/// `Passkey` blobs so the types are whatever webauthn-rs itself produced. Sent
/// as `exclude_credentials`, which makes an authenticator that already holds
/// one of them refuse rather than silently create a duplicate.
///
/// A row whose JSON no longer parses is skipped rather than fatal: excluding
/// is a convenience, and failing the whole ceremony over one unreadable row
/// would lock the user out of adding a key at all.
fn existing_credentials(conn: &Connection, account_id: i64) -> Result<Vec<CredentialID>, Rejection> {
    let mut stmt = conn
        .prepare("SELECT passkey_json FROM passkeys WHERE account_id = ?1")
        .map_err(internal)?;
    let rows = stmt
        .query_map([account_id], |r| r.get::<_, String>(0))
        .map_err(internal)?
        .collect::<rusqlite::Result<Vec<String>>>()
        .map_err(internal)?;
    Ok(rows
        .iter()
        .filter_map(|json| serde_json::from_str::<Passkey>(json).ok())
        .map(|pk| pk.cred_id().clone())
        .collect())
}

pub(crate) async fn add_passkey_start(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, Rejection> {
    let webauthn = webauthn_of(&state)?;
    let (info, exclude) = {
        let guard = state.conn.lock().map_err(internal)?;
        let (account_id, name) = signed_in(&guard, &headers)?;
        let existing = existing_credentials(&guard, account_id)?;
        (
            RegInfo { name, invite_id: None, account_id: Some(account_id) },
            (!existing.is_empty()).then_some(existing),
        )
    };
    let (options, reg_state) = webauthn
        .start_passkey_registration(random_uuid(), &info.name, &info.name, exclude)
        .map_err(|e| internal(format!("could not start registration: {e:?}")))?;
    let reg_id = random_token();
    state.pending.put_reg(reg_id.clone(), info, reg_state);
    Ok(Json(json!({ "regId": reg_id, "options": options })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddPasskeyFinishReq {
    reg_id: String,
    credential: RegisterPublicKeyCredential,
}

/// Finishes a self-service registration. The token is re-checked against the
/// pending ceremony's account: a ceremony started by one account must never be
/// finishable with another account's token, or a race could bind a key to the
/// wrong row set.
///
/// `complete_registration` mints a token for the new credential, but this
/// device already has a working one and the new passkey is an *additional*
/// credential, not a new session — so the minted token is dropped again inside
/// the same request and never leaves the server. The device that later signs
/// in with the new key mints its own.
pub(crate) async fn add_passkey_finish(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<AddPasskeyFinishReq>,
) -> Result<Json<Value>, Rejection> {
    let webauthn = webauthn_of(&state)?;
    let (info, reg_state) = state.pending.take_reg(&req.reg_id).ok_or((
        StatusCode::GONE,
        "This registration attempt expired — start again.".into(),
    ))?;
    let passkey = webauthn
        .finish_passkey_registration(&req.credential, &reg_state)
        .map_err(|e| (StatusCode::UNAUTHORIZED, format!("registration rejected: {e:?}")))?;
    let cred_id_hex = crate::to_hex(passkey.cred_id().as_ref());
    let passkey_json = serde_json::to_string(&passkey).map_err(internal)?;

    let mut guard = state.conn.lock().map_err(internal)?;
    let (account_id, _) = signed_in(&guard, &headers)?;
    if info.account_id != Some(account_id) {
        return Err(unauthorized());
    }
    let (name, token) =
        complete_registration(&mut guard, &info, &cred_id_hex, &passkey_json, "passkey")?;
    guard
        .execute("DELETE FROM tokens WHERE token_hash = ?1", [token_hash(&token)])
        .map_err(internal)?;
    Ok(Json(json!({ "name": name, "credId": cred_id_hex })))
}

/// The passkeys really attached to the signed-in account.
///
/// The table stores no device name — the server never learns one — so `label`
/// is derived from what it does store: a short prefix of the credential id.
/// Inventing a friendlier name here would be inventing a fact.
pub(crate) async fn list_passkeys(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, Rejection> {
    let guard = state.conn.lock().map_err(internal)?;
    let (account_id, _) = signed_in(&guard, &headers)?;
    let mut stmt = guard
        .prepare(
            "SELECT cred_id, created_at FROM passkeys WHERE account_id = ?1 ORDER BY created_at",
        )
        .map_err(internal)?;
    let rows = stmt
        .query_map([account_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(internal)?
        .collect::<rusqlite::Result<Vec<(String, i64)>>>()
        .map_err(internal)?;
    let out: Vec<Value> = rows
        .into_iter()
        .map(|(cred_id, created_at)| {
            let label = format!("Passkey {}", short_cred(&cred_id));
            json!({ "credId": cred_id, "label": label, "createdAt": created_at })
        })
        .collect();
    Ok(Json(json!(out)))
}

/// A credential id is long and opaque; the first few characters are enough to
/// tell two of them apart in a list.
fn short_cred(cred_id: &str) -> String {
    cred_id.chars().take(8).collect()
}

pub(crate) async fn login_start(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, Rejection> {
    let webauthn = webauthn_of(&state)?;
    let (options, auth_state) = webauthn
        .start_discoverable_authentication()
        .map_err(|e| internal(format!("could not start login: {e:?}")))?;
    let auth_id = random_token();
    state.pending.put_auth(auth_id.clone(), auth_state);
    Ok(Json(json!({ "authId": auth_id, "options": options })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoginFinishReq {
    auth_id: String,
    #[serde(default)]
    label: Option<String>,
    credential: PublicKeyCredential,
}

pub(crate) async fn login_finish(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LoginFinishReq>,
) -> Result<Json<Value>, Rejection> {
    let webauthn = webauthn_of(&state)?;
    let auth_state = state.pending.take_auth(&req.auth_id).ok_or((
        StatusCode::GONE,
        "This sign-in attempt expired — start again.".into(),
    ))?;
    let (_, cred_id) = webauthn
        .identify_discoverable_authentication(&req.credential)
        .map_err(|e| (StatusCode::UNAUTHORIZED, format!("credential rejected: {e:?}")))?;
    let cred_id_hex = crate::to_hex(cred_id);

    let mut guard = state.conn.lock().map_err(internal)?;
    let row: Option<(i64, i64, String, String)> = guard
        .query_row(
            "SELECT p.id, p.account_id, p.passkey_json, a.name
             FROM passkeys p JOIN accounts a ON a.id = p.account_id
             WHERE p.cred_id = ?1",
            [&cred_id_hex],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(internal)?;
    let Some((passkey_row, account_id, passkey_json, name)) = row else {
        return Err((StatusCode::UNAUTHORIZED, "Unknown passkey.".into()));
    };
    let mut passkey: Passkey = serde_json::from_str(&passkey_json).map_err(internal)?;

    let result = webauthn
        .finish_discoverable_authentication(
            &req.credential,
            auth_state,
            &[DiscoverableKey::from(&passkey)],
        )
        .map_err(|e| (StatusCode::UNAUTHORIZED, format!("sign-in rejected: {e:?}")))?;

    let tx = guard.transaction().map_err(internal)?;
    if passkey.update_credential(&result) == Some(true) {
        tx.execute(
            "UPDATE passkeys SET passkey_json = ?1 WHERE id = ?2",
            params![serde_json::to_string(&passkey).map_err(internal)?, passkey_row],
        )
        .map_err(internal)?;
    }
    let label = req.label.as_deref().unwrap_or("passkey");
    let token = mint_token(&tx, account_id, label).map_err(internal)?;
    tx.commit().map_err(internal)?;
    Ok(Json(json!({ "name": name, "token": token })))
}

#[derive(Deserialize)]
pub(crate) struct InviteReq {
    #[serde(default)]
    name: Option<String>,
}

/// Admin-minted invite. With a `name` it can also attach a passkey to that
/// existing account; without one it is a plain signup pass (useful when
/// `ALBAS_SYNC_SIGNUPS=invite`).
///
/// Kept for that case and for the passkey-onto-existing-account use, but not
/// getting further admin support: there is no list/revoke endpoint, and the
/// admin console has no Invites panel. Product direction is open signup only
/// — see `main.rs`'s module doc comment and root `CLAUDE.md`.
pub(crate) async fn create_invite(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<InviteReq>,
) -> Result<(StatusCode, Json<Value>), Rejection> {
    admin_ok(&state, &headers).map_err(|s| (s, String::new()))?;
    let name = match req.name.as_deref().map(str::trim) {
        Some(n) if !n.is_empty() => {
            if !name_ok(n) {
                return Err((
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Account names are 1-64 characters: letters, digits, '-' or '_'.".into(),
                ));
            }
            Some(n.to_string())
        }
        _ => None,
    };
    let code = random_token();
    let expires_at = now_ms() + INVITE_TTL_MS;
    let guard = state.conn.lock().map_err(internal)?;
    guard
        .execute(
            "INSERT INTO invites (code_hash, name, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
            params![token_hash(&code), name, now_ms(), expires_at],
        )
        .map_err(internal)?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "code": code, "name": name, "expiresAt": expires_at })),
    ))
}

/// Android Digital Asset Links: binds the app's signing certificate to this
/// domain so Credential Manager will do passkey ceremonies for it. Content
/// comes verbatim from `ALBAS_SYNC_ASSETLINKS`.
pub(crate) async fn assetlinks(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match &state.assetlinks {
        Some(body) => (
            StatusCode::OK,
            [("content-type", "application/json")],
            body.clone(),
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        crate::init_db(&mut c, None).unwrap();
        c
    }

    fn add_account(c: &Connection, name: &str) -> i64 {
        c.execute("INSERT INTO accounts (name, created_at) VALUES (?1, 0)", [name]).unwrap();
        c.last_insert_rowid()
    }

    fn add_invite(c: &Connection, code: &str, name: Option<&str>, expires_at: i64) -> i64 {
        c.execute(
            "INSERT INTO invites (code_hash, name, created_at, expires_at) VALUES (?1, ?2, 0, ?3)",
            params![token_hash(code), name, expires_at],
        )
        .unwrap();
        c.last_insert_rowid()
    }

    fn far_future() -> i64 {
        now_ms() + 1_000_000
    }

    #[test]
    fn open_signup_creates_without_invite() {
        let c = mem();
        let info = resolve_registration(&c, Signups::Open, None, "sarah").unwrap();
        assert_eq!(info.name, "sarah");
        assert!(info.invite_id.is_none());
        assert!(info.account_id.is_none());
    }

    #[test]
    fn invite_mode_rejects_inviteless_signup() {
        let c = mem();
        let err = resolve_registration(&c, Signups::InviteOnly, None, "sarah").unwrap_err();
        assert_eq!(err.0, StatusCode::FORBIDDEN);
        add_invite(&c, "invite-code-1", None, far_future());
        let info =
            resolve_registration(&c, Signups::InviteOnly, Some("invite-code-1"), "sarah").unwrap();
        assert_eq!(info.name, "sarah");
        assert!(info.invite_id.is_some());
    }

    #[test]
    fn taken_name_needs_a_matching_invite_to_attach() {
        let c = mem();
        let owner = add_account(&c, "owner");

        // Open signup on a taken name is a plain conflict…
        let err = resolve_registration(&c, Signups::Open, None, "owner").unwrap_err();
        assert_eq!(err.0, StatusCode::CONFLICT);

        // …and so is an unpinned invite: it must name the account.
        add_invite(&c, "generic-invite", None, far_future());
        let err =
            resolve_registration(&c, Signups::Open, Some("generic-invite"), "owner").unwrap_err();
        assert_eq!(err.0, StatusCode::CONFLICT);

        add_invite(&c, "owner-invite", Some("owner"), far_future());
        let info = resolve_registration(&c, Signups::Open, Some("owner-invite"), "ignored").unwrap();
        assert_eq!(info.account_id, Some(owner), "pinned invite attaches to the account");
        assert_eq!(info.name, "owner", "the invite's name wins over the requested one");
    }

    #[test]
    fn expired_and_used_invites_are_rejected() {
        let c = mem();
        add_invite(&c, "old-invite", None, now_ms() - 1);
        let err = resolve_registration(&c, Signups::Open, Some("old-invite"), "x").unwrap_err();
        assert_eq!(err.0, StatusCode::GONE);

        let id = add_invite(&c, "used-invite", None, far_future());
        c.execute("UPDATE invites SET used_at = 1 WHERE id = ?1", [id]).unwrap();
        let err = resolve_registration(&c, Signups::Open, Some("used-invite"), "x").unwrap_err();
        assert_eq!(err.0, StatusCode::GONE);

        let err = resolve_registration(&c, Signups::Open, Some("no-such-invite"), "x").unwrap_err();
        assert_eq!(err.0, StatusCode::NOT_FOUND);
    }

    /// The invite burns exactly once, atomically with account creation — a
    /// second finish with the same invite fails even if resolution raced.
    #[test]
    fn complete_registration_burns_the_invite_once() {
        let mut c = mem();
        let invite_id = add_invite(&c, "one-shot", None, far_future());
        let info =
            RegInfo { name: "sarah".into(), invite_id: Some(invite_id), account_id: None };

        let (name, token) =
            complete_registration(&mut c, &info, "cred-1", "{}", "passkey").unwrap();
        assert_eq!(name, "sarah");
        assert!(!token.is_empty());
        let account: i64 =
            c.query_row("SELECT id FROM accounts WHERE name = 'sarah'", [], |r| r.get(0)).unwrap();
        let stored: i64 = c
            .query_row("SELECT account_id FROM passkeys WHERE cred_id = 'cred-1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stored, account);

        let info2 =
            RegInfo { name: "eve".into(), invite_id: Some(invite_id), account_id: None };
        let err = complete_registration(&mut c, &info2, "cred-2", "{}", "passkey").unwrap_err();
        assert_eq!(err.0, StatusCode::GONE);
        let n: i64 =
            c.query_row("SELECT COUNT(*) FROM accounts WHERE name = 'eve'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0, "a burned invite must not leave a half-created account");
    }

    #[test]
    fn complete_registration_attaches_to_existing_account() {
        let mut c = mem();
        let owner = add_account(&c, "owner");
        let invite_id = add_invite(&c, "owner-invite", Some("owner"), far_future());
        let info =
            RegInfo { name: "owner".into(), invite_id: Some(invite_id), account_id: Some(owner) };
        complete_registration(&mut c, &info, "cred-o", "{}", "security-key").unwrap();
        let stored: i64 = c
            .query_row("SELECT account_id FROM passkeys WHERE cred_id = 'cred-o'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stored, owner);
        let n: i64 = c.query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "attach must not create a second account");
    }

    /// The self-service shape: no invite, an account id from the bearer token.
    /// It must attach, not create, and must not need an invite row.
    #[test]
    fn self_service_attach_needs_no_invite() {
        let mut c = mem();
        let owner = add_account(&c, "owner");
        let info = RegInfo { name: "owner".into(), invite_id: None, account_id: Some(owner) };
        complete_registration(&mut c, &info, "cred-self", "{}", "passkey").unwrap();
        let stored: i64 = c
            .query_row("SELECT account_id FROM passkeys WHERE cred_id = 'cred-self'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(stored, owner);
        let n: i64 = c.query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    fn headers_for(token: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("authorization", format!("Bearer {token}").parse().unwrap());
        h
    }

    #[test]
    fn signed_in_resolves_the_token_and_rejects_strangers() {
        let c = mem();
        let owner = add_account(&c, "owner");
        let token = mint_token(&c, owner, "device").unwrap();
        assert_eq!(signed_in(&c, &headers_for(&token)).unwrap(), (owner, "owner".to_string()));
        assert_eq!(
            signed_in(&c, &headers_for("not-a-token")).unwrap_err().0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(signed_in(&c, &HeaderMap::new()).unwrap_err().0, StatusCode::UNAUTHORIZED);
    }

    /// `exclude_credentials` is a convenience, so an unreadable stored blob is
    /// skipped rather than failing the whole ceremony.
    #[test]
    fn existing_credentials_skips_unparseable_rows() {
        let c = mem();
        let owner = add_account(&c, "owner");
        c.execute(
            "INSERT INTO passkeys (account_id, cred_id, passkey_json, created_at)
             VALUES (?1, 'cred-bad', '{}', 0)",
            [owner],
        )
        .unwrap();
        assert!(existing_credentials(&c, owner).unwrap().is_empty());
    }

    #[test]
    fn short_cred_is_a_prefix_and_never_panics_on_short_ids() {
        assert_eq!(short_cred("0123456789abcdef"), "01234567");
        assert_eq!(short_cred("ab"), "ab");
        assert_eq!(short_cred(""), "");
    }

    #[test]
    fn name_race_on_create_is_a_conflict() {
        let mut c = mem();
        add_account(&c, "sarah");
        let info = RegInfo { name: "sarah".into(), invite_id: None, account_id: None };
        let err = complete_registration(&mut c, &info, "cred-x", "{}", "passkey").unwrap_err();
        assert_eq!(err.0, StatusCode::CONFLICT);
    }
}
