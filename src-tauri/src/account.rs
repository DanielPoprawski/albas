//! Account plumbing for passkey sign-in and sharing.
//!
//! The WebAuthn ceremony itself runs in the frontend via
//! `tauri-plugin-webauthn` (it needs the platform authenticator); everything
//! that talks to the sync server happens here over ureq, exactly like
//! `sync.rs` — the WebView never contacts the server, so it needs no CORS.
//!
//! Flow: `auth_login_start`/`auth_register_start` fetch the ceremony options
//! and remember the server base URL in managed state; the frontend drives the
//! authenticator; `auth_*_finish` posts the credential back and, on success,
//! stores `__sync_url`/`__sync_token`/`__sync_account` and resets every sync
//! watermark — a different account's watermarks would make the first sync skip
//! rows.

use crate::db::{self, Db};
use crate::sync::{
    check_url, ACCOUNT_SETTING, DEFAULT_URL, META_GRANT_REV, META_SHARED_SEQ, TOKEN_SETTING,
    URL_SETTING,
};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

/// The server base URL of the ceremony in flight, set by `*_start` and
/// consumed by `*_finish` — so a finish can't be pointed at a different host
/// than the options came from.
#[derive(Default)]
pub struct AuthFlow(pub Mutex<Option<String>>);

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Normalises what the user typed into a server base URL: whitespace trimmed,
/// trailing slashes and a trailing `/sync` (the historical "endpoint" form)
/// stripped.
fn normalize_base(url: &str) -> String {
    let mut base = url.trim().trim_end_matches('/').to_string();
    if let Some(stripped) = base.strip_suffix("/sync") {
        base = stripped.trim_end_matches('/').to_string();
    }
    base
}

/// POSTs JSON and returns the parsed response, surfacing the server's plain
/// text error message (our Axum handlers reply with one) instead of a bare
/// status code.
fn post_json(url: &str, token: Option<&str>, body: &Value) -> Result<Value, String> {
    let mut req = ureq::post(url).timeout(Duration::from_secs(30));
    if let Some(t) = token {
        req = req.set("Authorization", &format!("Bearer {t}"));
    }
    match req.send_json(body) {
        Ok(r) => r.into_json().map_err(|e| format!("Bad response from server: {e}")),
        Err(e) => Err(friendly(e)),
    }
}

fn get_json(url: &str, token: &str) -> Result<Value, String> {
    ureq::get(url)
        .set("Authorization", &format!("Bearer {token}"))
        .timeout(Duration::from_secs(30))
        .call()
        .map_err(friendly)?
        .into_json()
        .map_err(|e| format!("Bad response from server: {e}"))
}

fn friendly(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, resp) => {
            let msg = resp.into_string().unwrap_or_default();
            let msg = msg.trim();
            if msg.is_empty() || msg.len() > 200 || msg.starts_with('<') {
                match code {
                    401 => "The server rejected this sign-in.".into(),
                    404 => "Not found.".into(),
                    _ => format!("Server returned HTTP {code}."),
                }
            } else {
                msg.to_string()
            }
        }
        other => format!("Couldn't reach the server: {other}"),
    }
}

/// The stored server base for signed-in calls (shares). `__sync_url` holds the
/// full `/sync` endpoint, so this is just the normalised form of it.
fn stored_base_and_token(conn: &Connection) -> Result<(String, String), String> {
    let url = db::read_setting(conn, URL_SETTING)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_URL.to_string());
    let token = db::read_setting(conn, TOKEN_SETTING)
        .filter(|s| !s.trim().is_empty())
        .ok_or("Not signed in.")?;
    Ok((normalize_base(&url), token.trim().to_string()))
}

fn device_label() -> String {
    // Enough to tell tokens apart in the server's table.
    format!("albas-{}", std::env::consts::OS)
}

#[derive(Deserialize)]
struct FinishRes {
    name: String,
    token: String,
}

fn start(app: &tauri::AppHandle, url: &str, path: &str, body: Value) -> Result<Value, String> {
    let base = normalize_base(url);
    check_url(&base)?;
    let res = post_json(&format!("{base}/{path}"), None, &body)?;
    *app.state::<AuthFlow>().0.lock().map_err(err)? = Some(base);
    Ok(res)
}

/// Completes a ceremony: posts the credential, then swaps this device onto the
/// returned account in one transaction. Local data is untouched — it will
/// full-push on the next sync — but every watermark resets, because they were
/// scoped to whatever account this device synced before.
fn finish(app: &tauri::AppHandle, path: &str, mut body: Value) -> Result<Value, String> {
    let base = app
        .state::<AuthFlow>()
        .0
        .lock()
        .map_err(err)?
        .clone()
        .ok_or("No sign-in in progress — start again.")?;
    body["label"] = json!(device_label());
    let res: FinishRes = serde_json::from_value(post_json(&format!("{base}/{path}"), None, &body)?)
        .map_err(|e| format!("Bad response from server: {e}"))?;

    let db = app.state::<Db>();
    let mut guard = db.0.lock().map_err(err)?;
    let tx = guard.transaction().map_err(err)?;
    tx.execute("DELETE FROM shared_rows", []).map_err(err)?;
    for key in ["sync_pull_seq", "sync_push_at", META_SHARED_SEQ, META_GRANT_REV] {
        db::write_meta(&tx, key, "0").map_err(err)?;
    }
    db::write_setting(&tx, URL_SETTING, &format!("{base}/sync")).map_err(err)?;
    db::write_setting(&tx, TOKEN_SETTING, &res.token).map_err(err)?;
    db::write_setting(&tx, ACCOUNT_SETTING, &res.name).map_err(err)?;
    tx.commit().map_err(err)?;
    *app.state::<AuthFlow>().0.lock().map_err(err)? = None;
    Ok(json!({ "name": res.name }))
}

#[tauri::command]
pub async fn auth_register_start(
    app: tauri::AppHandle,
    url: String,
    name: String,
    invite: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        start(&app, &url, "register/start", json!({ "name": name, "invite": invite }))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn auth_register_finish(
    app: tauri::AppHandle,
    reg_id: String,
    credential: Value,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        finish(&app, "register/finish", json!({ "regId": reg_id, "credential": credential }))
    })
    .await
    .map_err(err)?
}

/// Adds *another* passkey to the account this device is already signed into.
///
/// Unlike `auth_register_*` there is no invite and no name: the bearer token
/// already names the account, so the server resolves it from the
/// `Authorization` header. Nothing local is rewritten on finish — the device
/// keeps its existing token and session; the new credential is an extra way
/// into the same account, not a new sign-in.
#[tauri::command]
pub async fn auth_add_passkey_start(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (base, token) = {
            let db = app.state::<Db>();
            let conn = db.0.lock().map_err(err)?;
            stored_base_and_token(&conn)?
        };
        post_json(&format!("{base}/passkeys/start"), Some(&token), &json!({}))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn auth_add_passkey_finish(
    app: tauri::AppHandle,
    reg_id: String,
    credential: Value,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (base, token) = {
            let db = app.state::<Db>();
            let conn = db.0.lock().map_err(err)?;
            stored_base_and_token(&conn)?
        };
        post_json(
            &format!("{base}/passkeys/finish"),
            Some(&token),
            &json!({ "regId": reg_id, "credential": credential }),
        )
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn auth_login_start(app: tauri::AppHandle, url: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || start(&app, &url, "login/start", json!({})))
        .await
        .map_err(err)?
}

#[tauri::command]
pub async fn auth_login_finish(
    app: tauri::AppHandle,
    auth_id: String,
    credential: Value,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        finish(&app, "login/finish", json!({ "authId": auth_id, "credential": credential }))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn shares_list(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (base, token) = {
            let db = app.state::<Db>();
            let conn = db.0.lock().map_err(err)?;
            stored_base_and_token(&conn)?
        };
        get_json(&format!("{base}/shares"), &token)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn shares_set(
    app: tauri::AppHandle,
    name: String,
    calendar: bool,
    todos: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (base, token) = {
            let db = app.state::<Db>();
            let conn = db.0.lock().map_err(err)?;
            stored_base_and_token(&conn)?
        };
        let url = format!("{base}/shares/{name}");
        let res = ureq::request("PUT", &url)
            .set("Authorization", &format!("Bearer {token}"))
            .timeout(Duration::from_secs(30))
            .send_json(json!({ "calendar": calendar, "todos": todos }));
        match res {
            Ok(_) => Ok(()),
            Err(ureq::Error::Status(404, _)) => {
                Err(format!("No account named '{name}' on this server."))
            }
            Err(e) => Err(friendly(e)),
        }
    })
    .await
    .map_err(err)?
}

/// Clears the credentials and the shared cache; local data stays. The token
/// row on the server keeps existing until revoked there — signing back in
/// mints a fresh one.
#[tauri::command]
pub fn sync_sign_out(db: tauri::State<Db>) -> Result<(), String> {
    let mut guard = db.0.lock().map_err(err)?;
    let tx = guard.transaction().map_err(err)?;
    tx.execute("DELETE FROM shared_rows", []).map_err(err)?;
    for key in ["sync_pull_seq", "sync_push_at", META_SHARED_SEQ, META_GRANT_REV] {
        db::write_meta(&tx, key, "0").map_err(err)?;
    }
    db::write_setting(&tx, TOKEN_SETTING, "").map_err(err)?;
    db::write_setting(&tx, ACCOUNT_SETTING, "").map_err(err)?;
    tx.commit().map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_normalisation_strips_sync_suffix_and_slashes() {
        assert_eq!(normalize_base("https://s.example.com"), "https://s.example.com");
        assert_eq!(normalize_base("https://s.example.com/"), "https://s.example.com");
        assert_eq!(normalize_base("https://s.example.com/sync"), "https://s.example.com");
        assert_eq!(normalize_base(" https://s.example.com/sync/ "), "https://s.example.com");
        assert_eq!(normalize_base("http://localhost:8787/sync"), "http://localhost:8787");
    }

    /// The real server puts the API under `/api`, because the same origin also
    /// serves the web console. The base must keep that prefix — dropping it
    /// would send every ceremony to the console's routes instead.
    #[test]
    fn base_normalisation_keeps_a_path_prefix() {
        assert_eq!(
            normalize_base("https://albas.danni-dev.com/api/sync"),
            "https://albas.danni-dev.com/api"
        );
        assert_eq!(
            normalize_base("https://albas.danni-dev.com/api/"),
            "https://albas.danni-dev.com/api"
        );
        // What the shipped default already is, normalised to itself.
        assert_eq!(normalize_base(crate::sync::DEFAULT_URL), "https://albas.danni-dev.com/api");
    }
}
