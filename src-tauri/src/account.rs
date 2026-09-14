//! Account plumbing for sign-in and sharing.
//!
//! Sign-in itself happens in the system browser (see "Browser sign-in"
//! below) — nothing here drives a WebAuthn ceremony any more. Everything that
//! talks to the sync server happens over ureq, exactly like `sync.rs` — the
//! WebView never contacts the server, so it needs no CORS.

use crate::db::{self, Db};
use crate::sync::{
    ACCOUNT_SETTING, DEFAULT_URL, META_GRANT_REV, META_PULL_SEQ, META_PUSH_AT, META_SHARED_SEQ,
    URL_SETTING, check_url,
};
use serde_json::{Value, json};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

/// The server base URL of the browser sign-in in flight, set by
/// `app_signin_start` and consumed by `app_signin_poll` — so a poll can't be
/// pointed at a different host than the session was opened on.
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
        Ok(r) => r
            .into_json()
            .map_err(|e| format!("Bad response from server: {e}")),
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

/// The stored server base and bearer token for signed-in calls (shares,
/// `sync_api`, cross-device handoff). `__sync_url` holds the full `/sync`
/// endpoint, so the base is just the normalised form of it; the token itself
/// comes from `token_store` (OS keyring on desktop), not from settings —
/// see `token_store.rs`.
fn stored_base_and_token(db: &Db) -> Result<(String, String), String> {
    let url = {
        let conn = db.0.lock().map_err(err)?;
        db::read_setting(&conn, URL_SETTING)
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_URL.to_string())
    };
    let token = crate::token_store::get(db).ok_or("Not signed in.")?;
    Ok((normalize_base(&url), token))
}

/// Forgets everything scoped to the account this device last synced: the
/// shared cache and every watermark. Local data stays — it full-pushes to
/// whichever account comes next. `account` is what `__sync_account` becomes
/// (the new name on adoption, empty on sign-out).
fn reset_session_rows(tx: &rusqlite::Connection, account: &str) -> rusqlite::Result<()> {
    tx.execute("DELETE FROM shared_rows", [])?;
    for key in [META_PULL_SEQ, META_PUSH_AT, META_SHARED_SEQ, META_GRANT_REV] {
        db::write_meta(tx, key, "0")?;
    }
    db::write_setting(tx, ACCOUNT_SETTING, account)
}

/// The local half of leaving an account: token and marker gone, session rows
/// reset. Shared by sign-out, account deletion, and a `/sync` 401 (the server
/// no longer knows the token). Never talks to the server.
pub(crate) fn clear_session(db: &Db) -> Result<(), String> {
    crate::token_store::clear(db)?;
    let mut guard = db.0.lock().map_err(err)?;
    let tx = guard.transaction().map_err(err)?;
    reset_session_rows(&tx, "").map_err(err)?;
    tx.commit().map_err(err)
}

/// Swaps this device onto an account in one transaction. Local data is
/// untouched — it will full-push on the next sync — but every watermark
/// resets, because they were scoped to whatever account this device synced
/// before. Called once the browser sign-in reports a token.
fn adopt_session(
    app: &tauri::AppHandle,
    base: &str,
    token: &str,
    name: &str,
) -> Result<(), String> {
    let db = app.state::<Db>();
    {
        let mut guard = db.0.lock().map_err(err)?;
        let tx = guard.transaction().map_err(err)?;
        reset_session_rows(&tx, name).map_err(err)?;
        db::write_setting(&tx, URL_SETTING, &format!("{base}/sync")).map_err(err)?;
        tx.commit().map_err(err)?;
    }
    // Outside the transaction/lock above: `token_store::set` takes its own
    // lock on `db.0` (for the marker write on mobile, or just the marker on
    // desktop) and, on desktop, talks to the OS keyring — neither belongs
    // inside a SQLite transaction. If storing the token fails (no Secret
    // Service on a bare Linux box, say) the account name written above must
    // not survive on its own, or the UI reads as signed in with no credential.
    if let Err(e) = crate::token_store::set(&db, token) {
        let _ = clear_session(&db);
        return Err(format!("Signed in, but the token could not be stored on this device: {e}"));
    }
    Ok(())
}

/// Settings › Advanced: connect with a pasted bearer token (an operator-minted
/// credential, or one copied from another device). Adopts it like any other
/// sign-in; the first sync then proves it — a rejected token clears the
/// session again via the 401 path in `sync.rs`.
#[tauri::command]
pub async fn sync_connect_token(app: tauri::AppHandle, url: String, token: String) -> Result<(), String> {
    let base = normalize_base(&url);
    check_url(&format!("{base}/sync"))?;
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Paste a token first.".into());
    }
    tauri::async_runtime::spawn_blocking(move || adopt_session(&app, &base, &token, ""))
        .await
        .map_err(err)?
}

#[tauri::command]
pub async fn shares_list(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (base, token) = {
            let db = app.state::<Db>();
            stored_base_and_token(&db)?
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
            stored_base_and_token(&db)?
        };
        let url = format!("{base}/shares/{name}");
        let res = ureq::request("PUT", &url)
            .set("Authorization", &format!("Bearer {token}"))
            .timeout(Duration::from_secs(30))
            .send_json(json!({ "calendar": calendar, "todos": todos }));
        // The server always answers 200 now (never 404 for an unknown
        // grantee — see sync-server/README.md, "Sharing"): unrecognised
        // names come back as `{"ok": false}` instead, so account-name
        // enumeration isn't observable from the HTTP status alone.
        let body: Value = match res {
            Ok(r) => r
                .into_json()
                .map_err(|e| format!("Bad response from server: {e}"))?,
            Err(e) => return Err(friendly(e)),
        };
        if body.get("ok").and_then(|v| v.as_bool()) == Some(false) {
            return Err(format!("No account named '{name}' on this server."));
        }
        Ok(())
    })
    .await
    .map_err(err)?
}

/// Clears the credentials and the shared cache; local data stays. Best-effort
/// revokes this device's token server-side first (`DELETE /tokens/current`)
/// so it stops showing up in Settings → Sessions on other devices and can't
/// be replayed — but a failure there (offline, server down) must never block
/// signing out locally; the token row is left for the server to expire on
/// its own sliding 90-day window either way.
#[tauri::command]
pub async fn sync_sign_out(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        if let Ok((base, token)) = stored_base_and_token(&db) {
            let _ = ureq::request("DELETE", &format!("{base}/tokens/current"))
                .set("Authorization", &format!("Bearer {token}"))
                .timeout(Duration::from_secs(10))
                .call();
        }
        clear_session(&db)
    })
    .await
    .map_err(err)?
}

/// Permanently deletes the signed-in account server-side (`DELETE /account`,
/// re-verified with the password like a password change) and then clears
/// local session state the same way `sync_sign_out` does — but *without*
/// first revoking `/tokens/current`, since the account and every token on it
/// are already gone once the server call succeeds. Local data (events, tasks,
/// habits) is untouched; it just stops being synced anywhere.
#[tauri::command]
pub async fn account_delete(app: tauri::AppHandle, password: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (base, token) = {
            let db = app.state::<Db>();
            stored_base_and_token(&db)?
        };
        let res = ureq::request("DELETE", &format!("{base}/account"))
            .set("Authorization", &format!("Bearer {token}"))
            .timeout(Duration::from_secs(30))
            .send_json(json!({ "password": password }));
        if let Err(e) = res {
            return Err(friendly(e));
        }
        clear_session(&app.state::<Db>())
    })
    .await
    .map_err(err)?
}

/// Fetches `GET /account/export` (every row this account owns, as JSON) and
/// writes it to a file in the app's data dir rather than handing the — for a
/// real account, potentially large — JSON blob back through the IPC bridge to
/// sit in a JS string. No dialog/fs plugin is set up for this app yet (see
/// `Cargo.toml`), so this is the "write from Rust, hand back the path" route
/// the Phase E handoff called out as the fallback; the file name uses a Unix
/// timestamp rather than a calendar date to avoid pulling in a date-formatting
/// crate for a filename.
#[tauri::command]
pub async fn account_export(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (base, token) = {
            let db = app.state::<Db>();
            stored_base_and_token(&db)?
        };
        let body = get_json(&format!("{base}/account/export"), &token)?;
        let text = serde_json::to_string_pretty(&body).map_err(|e| e.to_string())?;
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs();
        let path = dir.join(format!("albas-export-{stamp}.json"));
        std::fs::write(&path, text).map_err(|e| e.to_string())?;
        Ok(path.display().to_string())
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_normalisation_strips_sync_suffix_and_slashes() {
        assert_eq!(
            normalize_base("https://s.example.com"),
            "https://s.example.com"
        );
        assert_eq!(
            normalize_base("https://s.example.com/"),
            "https://s.example.com"
        );
        assert_eq!(
            normalize_base("https://s.example.com/sync"),
            "https://s.example.com"
        );
        assert_eq!(
            normalize_base(" https://s.example.com/sync/ "),
            "https://s.example.com"
        );
        assert_eq!(
            normalize_base("http://localhost:8787/sync"),
            "http://localhost:8787"
        );
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
        assert_eq!(
            normalize_base(crate::sync::DEFAULT_URL),
            "https://albas.danni-dev.com/api"
        );
    }
}

// --- Browser sign-in ---
//
// The ceremony runs on the public site, not in this WebView: that is what lets
// one flow cover passkeys, password + TOTP and (later) Google OAuth, and what
// makes iOS reachable at all, since `tauri-plugin-webauthn` has no iOS support.
//
// The app never sees the browser's session. It opens the portal with a nonce
// and polls until the page reports a token bound to that nonce. Deliberately
// not an `albas://` deep link — see `sync-server/src/app_session.rs`.

/// The portal that serves `/login`, derived from the API base by dropping the
/// `/api` prefix nginx strips before proxying. A self-hosted base without that
/// prefix is returned unchanged.
fn portal_base(base: &str) -> String {
    base.strip_suffix("/api")
        .unwrap_or(base)
        .trim_end_matches('/')
        .to_string()
}

fn get_json_unauth(url: &str) -> Result<Value, String> {
    ureq::get(url)
        .timeout(Duration::from_secs(30))
        .call()
        .map_err(friendly)?
        .into_json()
        .map_err(|e| format!("Bad response from server: {e}"))
}

/// Opens a pending sign-in. Returns the nonce to poll, the code to show the
/// user, and the URL the frontend should open in the system browser.
#[tauri::command]
pub async fn app_signin_start(
    app: tauri::AppHandle,
    url: String,
    screen: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = normalize_base(&url);
        check_url(&base)?;
        // Whitelisted rather than interpolated: this ends up in a URL handed to
        // the system browser, so it must not be caller-controlled text.
        let screen = match screen.as_deref() {
            Some("register") => "register",
            _ => "login",
        };
        let res = post_json(&format!("{base}/app-session"), None, &json!({}))?;
        let nonce = res["nonce"]
            .as_str()
            .ok_or("Bad response from server: no nonce")?;
        let code = res["code"].as_str().unwrap_or("");
        // The nonce rides in the URL *fragment*: fragments are never sent in
        // an HTTP request (not to this server on the next navigation, not to
        // any server the browser talks to), so it never ends up in an access
        // log. `web/src/App.tsx` reads `location.hash` first and falls back
        // to the query string for one release (old links already handed out
        // used `?app_session=`), then that fallback should be dropped.
        let portal = format!("{}/{}#app_session={}", portal_base(&base), screen, nonce);
        // Remembered the same way a ceremony is, so a poll can't be pointed at
        // a different host than the session was opened on.
        *app.state::<AuthFlow>().0.lock().map_err(err)? = Some(base);
        Ok(json!({ "nonce": nonce, "code": code, "url": portal }))
    })
    .await
    .map_err(err)?
}

/// One poll. Returns `pending`, `expired`, or `ready` — and on `ready` this
/// device is already switched onto the account before the frontend hears back.
#[tauri::command]
pub async fn app_signin_poll(app: tauri::AppHandle, nonce: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = app
            .state::<AuthFlow>()
            .0
            .lock()
            .map_err(err)?
            .clone()
            .ok_or("No sign-in in progress — start again.")?;
        let res = get_json_unauth(&format!("{base}/app-session/{nonce}"))?;
        match res["status"].as_str().unwrap_or("") {
            "ready" => {
                let token = res["token"]
                    .as_str()
                    .ok_or("Bad response from server: no token")?;
                let name = res["account"].as_str().unwrap_or("");
                adopt_session(&app, &base, token, name)?;
                *app.state::<AuthFlow>().0.lock().map_err(err)? = None;
                Ok(json!({ "status": "ready", "account": name }))
            }
            "expired" => {
                *app.state::<AuthFlow>().0.lock().map_err(err)? = None;
                Ok(json!({ "status": "expired" }))
            }
            _ => Ok(json!({ "status": "pending" })),
        }
    })
    .await
    .map_err(err)?
}

/// Abandons a sign-in so a later poll can't resume it. The server row is left
/// to expire on its own — it is useless without the nonce.
#[tauri::command]
pub async fn app_signin_cancel(app: tauri::AppHandle) -> Result<(), String> {
    *app.state::<AuthFlow>().0.lock().map_err(err)? = None;
    Ok(())
}

// --- Password sign-in (in-app) ---
//
// A password is the mandatory first credential, and unlike a passkey it needs
// no OS authenticator, so it is the one sign-in that runs entirely in the app:
// the WebView asks Rust, Rust asks the server over ureq, and the browser
// handoff above becomes the secondary path for passkeys and Google.

/// Resolves the base to sign in against: what the caller passed (the
/// user-editable server field), else the shipped default.
fn signin_base(url: &str) -> Result<String, String> {
    let base = if url.trim().is_empty() {
        DEFAULT_URL.to_string()
    } else {
        url.to_string()
    };
    let base = normalize_base(&base);
    check_url(&base)?;
    Ok(base)
}

#[tauri::command]
pub async fn account_register_password(
    app: tauri::AppHandle,
    url: String,
    name: String,
    password: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = signin_base(&url)?;
        let res = post_json(
            &format!("{base}/register/password"),
            None,
            &json!({ "name": name.trim(), "password": password }),
        )?;
        let token = res["token"]
            .as_str()
            .ok_or("Bad response from server: no token")?;
        let account = res["name"].as_str().unwrap_or(name.trim());
        adopt_session(&app, &base, token, account)?;
        Ok(json!({ "status": "ready", "account": account }))
    })
    .await
    .map_err(err)?
}

/// `status` is `ready` (this device is now on the account) or `totp_required`
/// (the account has a confirmed authenticator and no code was sent — ask for
/// one and call again). A wrong password or code is an `Err` with the
/// server's message.
#[tauri::command]
pub async fn account_login_password(
    app: tauri::AppHandle,
    url: String,
    name: String,
    password: String,
    code: Option<String>,
    // A one-time recovery code, used in place of `code` when the
    // authenticator itself isn't available. See `sync-server/src/totp.rs`'s
    // recovery-code contract.
    recovery_code: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = signin_base(&url)?;
        let mut body = json!({ "name": name.trim(), "password": password });
        if let Some(code) = code.map(|c| c.trim().to_string()).filter(|c| !c.is_empty()) {
            body["code"] = Value::String(code);
        }
        if let Some(rc) = recovery_code
            .map(|c| c.trim().to_string())
            .filter(|c| !c.is_empty())
        {
            body["recovery_code"] = Value::String(rc);
        }
        let res = ureq::post(&format!("{base}/login/password"))
            .timeout(Duration::from_secs(30))
            .send_json(&body);
        let res = match res {
            Ok(r) => r
                .into_json::<Value>()
                .map_err(|e| format!("Bad response from server: {e}"))?,
            Err(ureq::Error::Status(428, _)) => return Ok(json!({ "status": "totp_required" })),
            Err(e) => return Err(friendly(e)),
        };
        let token = res["token"]
            .as_str()
            .ok_or("Bad response from server: no token")?;
        let account = res["name"].as_str().unwrap_or(name.trim());
        adopt_session(&app, &base, token, account)?;
        Ok(json!({ "status": "ready", "account": account }))
    })
    .await
    .map_err(err)?
}

/// One authenticated call against the signed-in server, for the credential
/// management in Settings (`/passkeys`, `/password`, `/totp`…). The WebView
/// can't `fetch` the server itself — its origin is `tauri://localhost`, the
/// server has no CORS layer, and WebKit reports that as a bare "Load failed"
/// — so every such request hops through here, the same way sync and shares do.
///
/// Returns `{ status, body }` for any HTTP answer, including errors, so the
/// caller can treat a 404 as "server too old" the way the old fetch code did;
/// only a transport failure is an `Err`.
#[tauri::command]
pub async fn sync_api(
    app: tauri::AppHandle,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !path.starts_with('/') || path.contains("..") {
            return Err(format!("Bad API path: {path}"));
        }
        let (base, token) = {
            let db = app.state::<Db>();
            stored_base_and_token(&db)?
        };
        let method = method.to_ascii_uppercase();
        let req = ureq::request(&method, &format!("{base}{path}"))
            .set("Authorization", &format!("Bearer {token}"))
            .timeout(Duration::from_secs(30));
        let res = match body {
            Some(b) => req.send_json(&b),
            None => req.call(),
        };
        let resp = match res {
            Ok(r) => r,
            Err(ureq::Error::Status(_, r)) => r,
            Err(e) => return Err(friendly(e)),
        };
        let status = resp.status();
        let text = resp
            .into_string()
            .map_err(|e| format!("Bad response from server: {e}"))?;
        let body = serde_json::from_str::<Value>(&text)
            .unwrap_or_else(|_| json!({ "message": text.trim() }));
        Ok(json!({ "status": status, "body": body }))
    })
    .await
    .map_err(err)?
}

// --- Cross-device sign-in ---
//
// Both directions reuse the browser handoff's `app_sessions` rows; the only
// new fact is that `POST /app-session/claim` accepts *any* account token, so a
// signed-in app can approve a sign-in as well as a signed-in browser can.

/// A signed-in device approving another device's pending sign-in (the nonce
/// came in over a QR code). Returns the code the other screen is showing.
#[tauri::command]
pub async fn app_session_claim(app: tauri::AppHandle, nonce: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (base, token) = {
            let db = app.state::<Db>();
            stored_base_and_token(&db)?
        };
        let res = post_json(
            &format!("{base}/app-session/claim"),
            Some(&token),
            &json!({ "nonce": nonce.trim() }),
        )?;
        Ok(json!({
            "code": res["code"].as_str().unwrap_or(""),
            "account": res["account"].as_str().unwrap_or(""),
        }))
    })
    .await
    .map_err(err)?
}

/// The reverse: a signed-in device opens a session and claims it for itself
/// right away, so that a signed-out device that learns the nonce (QR again)
/// can poll it and adopt this account. Five-minute, single-use, like every
/// app session.
#[tauri::command]
pub async fn app_session_offer(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (base, token) = {
            let db = app.state::<Db>();
            stored_base_and_token(&db)?
        };
        let created = post_json(&format!("{base}/app-session"), None, &json!({}))?;
        let nonce = created["nonce"]
            .as_str()
            .ok_or("Bad response from server: no nonce")?;
        let claimed = post_json(
            &format!("{base}/app-session/claim"),
            Some(&token),
            &json!({ "nonce": nonce }),
        )?;
        // Fragment, not query — see the matching comment in `app_signin_start`.
        let url = format!("{}/login#linked={}", portal_base(&base), nonce);
        Ok(json!({
            "nonce": nonce,
            "code": claimed["code"].as_str().unwrap_or(""),
            "url": url,
            "server": base,
        }))
    })
    .await
    .map_err(err)?
}

/// Points the poll loop at a session this device did *not* create — one it
/// scanned. After this, `app_signin_poll` works exactly as for a browser
/// sign-in.
#[tauri::command]
pub async fn app_signin_attach(
    app: tauri::AppHandle,
    url: String,
    nonce: String,
) -> Result<Value, String> {
    let base = signin_base(&url)?;
    let nonce = nonce.trim().to_string();
    if nonce.is_empty() || !nonce.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("That code isn't an Albas sign-in code.".into());
    }
    *app.state::<AuthFlow>().0.lock().map_err(err)? = Some(base);
    Ok(json!({ "nonce": nonce }))
}
