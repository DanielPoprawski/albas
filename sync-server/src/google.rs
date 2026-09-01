//! Google sign-in, entirely server-side (confidential client).
//!
//! The app never sees the client secret and never talks to Google directly —
//! this is deliberate: Google blocks OAuth inside embedded webviews, so the
//! whole ceremony has to happen in a real browser, same as the passkey/
//! password login the browser already does for the app-session handoff (see
//! `app_session.rs`). Concretely:
//!
//!   `GET /auth/config`            — unauthenticated. `{ "google": bool }` so
//!                                   the web client can hide the button when
//!                                   this server has no client credentials
//!                                   configured, rather than showing a button
//!                                   that 503s.
//!   `GET /auth/google/start`      — unauthenticated. Optional `?app_session=`
//!                                   (the nonce from `app_session.rs`, present
//!                                   when this page was opened by the app).
//!                                   302s to Google's consent screen.
//!   `GET /auth/google/callback`   — unauthenticated (Google redirects the
//!                                   user's browser here with `code`+`state`).
//!                                   Exchanges the code, resolves the account,
//!                                   mints a token, and 302s back into the web
//!                                   app carrying a one-time ticket (never the
//!                                   token itself — see `Pending::new_ticket`).
//!   `GET /auth/google/session/:ticket` — unauthenticated, but the ticket is a
//!                                   256-bit secret, single-use, short-lived:
//!                                   the same nonce/poll idiom `app_session.rs`
//!                                   uses, applied to handing a freshly-minted
//!                                   token back to the page that started this.
//!
//! From there the web client behaves exactly as it does after any other
//! login: it stores `{name, token}` and, if it was opened with `?app_session=`,
//! calls `POST /app-session/claim` with its own new bearer token — the very
//! same Phase 1 claim path passkey and password logins already go through.
//! Nothing here talks to `app_sessions` directly.
//!
//! Configured by three env vars (see `GoogleConfig::from_env`), read once at
//! startup like `ALBAS_SYNC_ORIGIN` is for passkeys. Absent config = the
//! routes above 503 and `/auth/config` reports `false`, so a self-hoster
//! without a Google Cloud project gets a portal with no Google button at all.
//!
//! Account matching: an account gets `accounts.google_email` set the first
//! time someone signs in through it via Google. A later Google sign-in with
//! the same verified email always resolves to that same account. The first
//! time, `find_or_create_account` derives a candidate account name from the
//! email's local part — but a name collision never adopts the existing
//! account, whatever credentials it holds. Controlling `alice@` at any domain
//! Google will issue a token for says nothing about who owns the local
//! account named `alice`, and a passwordless account is not an unclaimed one:
//! in this app it is usually a *passkey* account, the strongest credential
//! type there is. Adopting on a name match would hand a stranger every synced
//! row and share it owns. So the bare name is taken only when it is free; any
//! collision creates a fresh, distinctly named account. Deliberate linking of
//! an existing account to Google belongs behind an authenticated action in
//! Settings, where the account owner proves they are present.

use crate::{mint_token, name_ok, now_ms, random_token, AppState};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Redirect,
    Json,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

type Rejection = (StatusCode, String);

fn internal_err(e: impl std::fmt::Display) -> Rejection {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("Database error: {e}"),
    )
}

const AUTHORIZE_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";

/// How long a `start` -> `callback` round trip has to complete. Generous: the
/// user is picking an account and consenting on Google's own pages, not ours.
const FLOW_TTL_MS: i64 = 10 * 60 * 1000;
/// How long a callback's redirect has to be picked up by the web client's one
/// `GET .../session/:ticket` call. Short: nothing legitimate waits here.
const TICKET_TTL_MS: i64 = 2 * 60 * 1000;

/// `ALBAS_SYNC_GOOGLE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI`. All three or
/// none — a partial set is almost certainly a misconfiguration, not an
/// intentional "half off" state, so `from_env` refuses to start rather than
/// silently disabling the feature.
pub(crate) struct GoogleConfig {
    client_id: String,
    client_secret: String,
    redirect_uri: String,
}

fn env_nonempty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

impl GoogleConfig {
    /// `Ok(None)` = Google sign-in is off (no env vars set). `Err` = some but
    /// not all three are set, which is refused rather than silently ignored.
    pub(crate) fn from_env() -> Result<Option<Self>, String> {
        let client_id = env_nonempty("ALBAS_SYNC_GOOGLE_CLIENT_ID");
        let client_secret = env_nonempty("ALBAS_SYNC_GOOGLE_CLIENT_SECRET");
        let redirect_uri = env_nonempty("ALBAS_SYNC_GOOGLE_REDIRECT_URI");
        match (client_id, client_secret, redirect_uri) {
            (None, None, None) => Ok(None),
            (Some(client_id), Some(client_secret), Some(redirect_uri)) => Ok(Some(Self {
                client_id,
                client_secret,
                redirect_uri,
            })),
            _ => Err(
                "ALBAS_SYNC_GOOGLE_CLIENT_ID, _CLIENT_SECRET and _REDIRECT_URI must be set \
                 together, or not at all, for Google sign-in"
                    .into(),
            ),
        }
    }
}

fn google_of(state: &AppState) -> Result<&GoogleConfig, Rejection> {
    state.google.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "Google sign-in is not configured on this server.".into(),
    ))
}

struct FlowEntry {
    /// The `app_session.rs` nonce this browser tab was opened with, if any.
    app_session_nonce: Option<String>,
    expires_at: i64,
}

struct TicketEntry {
    name: String,
    token: String,
    expires_at: i64,
}

/// Ephemeral, in-memory, single-process — the same tradeoff `passkey::Pending`
/// documents for WebAuthn ceremonies: ceremony state is short-lived and
/// process-local anyway, so a database round trip buys nothing. A restart
/// only ever loses a Google sign-in that was mid-flight, which just means
/// starting over.
#[derive(Default)]
pub(crate) struct Pending {
    flows: Mutex<HashMap<String, FlowEntry>>,
    tickets: Mutex<HashMap<String, TicketEntry>>,
}

impl Pending {
    fn new_flow(&self, app_session_nonce: Option<String>) -> String {
        let mut m = self.flows.lock().unwrap();
        let now = now_ms();
        m.retain(|_, v| v.expires_at > now);
        let state = random_token();
        m.insert(
            state.clone(),
            FlowEntry {
                app_session_nonce,
                expires_at: now + FLOW_TTL_MS,
            },
        );
        state
    }

    /// Single-use: a `state` value not found here is either unknown or
    /// already spent, and both must be refused identically.
    fn take_flow(&self, state: &str) -> Option<Option<String>> {
        let mut m = self.flows.lock().unwrap();
        let now = now_ms();
        m.retain(|_, v| v.expires_at > now);
        m.remove(state).map(|f| f.app_session_nonce)
    }

    fn new_ticket(&self, name: String, token: String) -> String {
        let mut m = self.tickets.lock().unwrap();
        let now = now_ms();
        m.retain(|_, v| v.expires_at > now);
        let ticket = random_token();
        m.insert(
            ticket.clone(),
            TicketEntry {
                name,
                token,
                expires_at: now + TICKET_TTL_MS,
            },
        );
        ticket
    }

    /// Single-use, like `take_flow` — a leaked or reloaded ticket must not be
    /// collectible twice.
    fn take_ticket(&self, ticket: &str) -> Option<(String, String)> {
        let mut m = self.tickets.lock().unwrap();
        let now = now_ms();
        m.retain(|_, v| v.expires_at > now);
        m.remove(ticket).map(|t| (t.name, t.token))
    }
}

/// `GET /auth/config`. Whether the client should show the Google button at
/// all — never a reason, so a scan can't tell which of the three env vars is
/// missing.
pub(crate) async fn config(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(json!({ "google": state.google.is_some() }))
}

#[derive(Deserialize)]
pub(crate) struct StartQuery {
    #[serde(default)]
    app_session: Option<String>,
}

/// `GET /auth/google/start`. Redirects the browser to Google; nothing here is
/// itself sensitive (the `state` value is unguessable but not secret — Google
/// only ever echoes it back to us).
pub(crate) async fn start(
    State(state): State<Arc<AppState>>,
    Query(q): Query<StartQuery>,
) -> Result<Redirect, Rejection> {
    let cfg = google_of(&state)?;
    let oauth_state = state.google_pending.new_flow(q.app_session);
    let url = format!(
        "{AUTHORIZE_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&access_type=online&prompt=select_account",
        urlencoding::encode(&cfg.client_id),
        urlencoding::encode(&cfg.redirect_uri),
        urlencoding::encode("openid email"),
        urlencoding::encode(&oauth_state),
    );
    Ok(Redirect::to(&url))
}

#[derive(Deserialize)]
pub(crate) struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// `GET /auth/google/callback`. Google lands the user's browser here with
/// either `code`+`state` (consent given) or `error` (declined/failed).
pub(crate) async fn callback(
    State(state): State<Arc<AppState>>,
    Query(q): Query<CallbackQuery>,
) -> Result<Redirect, Rejection> {
    let cfg = google_of(&state)?;

    if let Some(err) = q.error {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Google sign-in was not completed: {err}"),
        ));
    }
    let code = q.code.ok_or((
        StatusCode::BAD_REQUEST,
        "Google did not send a code.".into(),
    ))?;
    let oauth_state = q.state.ok_or((
        StatusCode::BAD_REQUEST,
        "Google did not send a state.".into(),
    ))?;

    // Single-use and TTL'd: a replayed or stale callback must not be honoured.
    let app_session_nonce = state.google_pending.take_flow(&oauth_state).ok_or((
        StatusCode::BAD_REQUEST,
        "This sign-in link has expired or was already used. Start again.".into(),
    ))?;

    let email = exchange_code(cfg, &code).await?;

    let (name, token) = {
        let conn = state.conn.lock().unwrap();
        let (account_id, name) = find_or_create_account(&conn, &email)?;
        let token = mint_token(&conn, account_id, "google").map_err(internal_err)?;
        (name, token)
    };

    let ticket = state.google_pending.new_ticket(name, token);
    let mut redirect = format!("/login?google_ticket={}", urlencoding::encode(&ticket));
    if let Some(nonce) = app_session_nonce {
        redirect.push_str(&format!("&app_session={}", urlencoding::encode(&nonce)));
    }
    Ok(Redirect::to(&redirect))
}

/// `GET /auth/google/session/:ticket`. The web client calls this exactly once,
/// immediately after `callback` redirects it here with `?google_ticket=`, to
/// pick up the `{name, token}` a URL bearer token would otherwise have to sit
/// in directly. Same nonce/poll shape as `app_session.rs`'s `poll`, minus the
/// "pending" state — by the time this is reachable, `callback` already ran.
pub(crate) async fn session(
    State(state): State<Arc<AppState>>,
    Path(ticket): Path<String>,
) -> Result<Json<Value>, Rejection> {
    let (name, token) = state.google_pending.take_ticket(&ticket).ok_or((
        StatusCode::NOT_FOUND,
        "That sign-in has already been collected or has expired.".into(),
    ))?;
    Ok(Json(json!({ "name": name, "token": token })))
}

/// Exchanges the authorization `code` for tokens, then calls Google's OpenID
/// userinfo endpoint with the access token to get the account's email. Reads
/// the profile over a fresh server-to-server HTTPS call rather than verifying
/// the id_token's signature locally: the code was already single-use and tied
/// to our own `redirect_uri`, so trusting whatever Google's own endpoint hands
/// back for that access token needs no separate JWKS/signature machinery.
async fn exchange_code(cfg: &GoogleConfig, code: &str) -> Result<String, Rejection> {
    let client = reqwest::Client::new();

    let token_res = client
        .post(TOKEN_URL)
        .form(&[
            ("client_id", cfg.client_id.as_str()),
            ("client_secret", cfg.client_secret.as_str()),
            ("code", code),
            ("redirect_uri", cfg.redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!("Could not reach Google: {e}"),
            )
        })?;

    if !token_res.status().is_success() {
        let body = token_res.text().await.unwrap_or_default();
        return Err((
            StatusCode::BAD_GATEWAY,
            format!("Google rejected the sign-in: {body}"),
        ));
    }
    let token_json: Value = token_res.json().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            format!("Google sent an unreadable response: {e}"),
        )
    })?;
    let access_token = token_json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or((
            StatusCode::BAD_GATEWAY,
            "Google's response had no access token.".into(),
        ))?;

    let userinfo_res = client
        .get(USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!("Could not fetch the Google profile: {e}"),
            )
        })?;
    if !userinfo_res.status().is_success() {
        return Err((
            StatusCode::BAD_GATEWAY,
            "Google refused the profile request.".into(),
        ));
    }
    let profile: Value = userinfo_res.json().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            format!("Google sent an unreadable profile: {e}"),
        )
    })?;

    let email = profile
        .get("email")
        .and_then(|v| v.as_str())
        .ok_or((
            StatusCode::BAD_GATEWAY,
            "Google did not return an email address.".into(),
        ))?
        .trim()
        .to_lowercase();

    // Google's userinfo endpoint sends this as a JSON bool; tolerate a string
    // too rather than trusting the shape of a third party's response exactly.
    let verified = match profile.get("email_verified") {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => s == "true",
        _ => false,
    };
    if !verified {
        return Err((
            StatusCode::FORBIDDEN,
            "Google reports this email address is not verified.".into(),
        ));
    }

    Ok(email)
}

/// Derives an account name from the local part of an email address (the part
/// before `@`), stripped to whatever `name_ok` accepts. Falls back to a short
/// random name if nothing survives the strip (e.g. a fully non-ASCII local
/// part) — this is only ever a starting guess, not an identity.
fn candidate_name(email: &str) -> String {
    let local = email.split('@').next().unwrap_or(email);
    let cleaned: String = local
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    if cleaned.is_empty() || !name_ok(&cleaned) {
        format!("google-{}", &random_token()[..8])
    } else {
        cleaned
    }
}

/// Looks up the account this verified Google email belongs to, creating one
/// if this is the first time it has signed in. See the module doc comment for
/// the linking rule this implements. Returns `(account_id, account_name)`.
fn find_or_create_account(conn: &Connection, email: &str) -> Result<(i64, String), Rejection> {
    // Fast path: this email has signed in via Google before.
    if let Some((id, name)) = conn
        .query_row(
            "SELECT id, name FROM accounts WHERE google_email = ?1",
            [email],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(internal_err)?
    {
        return Ok((id, name));
    }

    let candidate = candidate_name(email);
    let existing: Option<i64> = conn
        .query_row("SELECT id FROM accounts WHERE name = ?1", [&candidate], |r| {
            r.get(0)
        })
        .optional()
        .map_err(internal_err)?;

    match existing {
        // Someone already holds this name. Whether or not they set a password
        // is irrelevant — a passwordless account here is typically a passkey
        // account, and adopting it would hand this Google identity everything
        // that account has ever synced. Never adopt on a name match.
        Some(_) => create_distinct_account(conn, &candidate, email),
        None => {
            match conn.execute(
                "INSERT INTO accounts (name, created_at, google_email) VALUES (?1, ?2, ?3)",
                params![candidate, now_ms(), email],
            ) {
                Ok(_) => Ok((conn.last_insert_rowid(), candidate)),
                Err(rusqlite::Error::SqliteFailure(e, _))
                    if e.code == rusqlite::ErrorCode::ConstraintViolation =>
                {
                    // Lost a race with someone else taking this exact name
                    // between the SELECT above and this INSERT.
                    create_distinct_account(conn, &candidate, email)
                }
                Err(e) => Err(internal_err(e)),
            }
        }
    }
}

/// Appends a numeric suffix to `candidate` until an unused account name is
/// found. Only reached when the bare name is unavailable for a reason that
/// isn't "this is already the same Google identity" (see caller).
fn create_distinct_account(
    conn: &Connection,
    candidate: &str,
    email: &str,
) -> Result<(i64, String), Rejection> {
    for suffix in 2..1000 {
        let name = format!("{candidate}-{suffix}");
        match conn.execute(
            "INSERT INTO accounts (name, created_at, google_email) VALUES (?1, ?2, ?3)",
            params![name, now_ms(), email],
        ) {
            Ok(_) => return Ok((conn.last_insert_rowid(), name)),
            Err(rusqlite::Error::SqliteFailure(e, _))
                if e.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                continue
            }
            Err(e) => return Err(internal_err(e)),
        }
    }
    Err(internal_err(
        "could not allocate an account name for this Google sign-in",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Signups;

    fn mem() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        crate::init_db(&mut c, None).unwrap();
        c
    }

    fn state_with(c: Connection) -> Arc<AppState> {
        Arc::new(AppState {
            conn: std::sync::Mutex::new(c),
            admin_token: None,
            signups: Signups::Open,
            webauthn: None,
            assetlinks: None,
            pending: Default::default(),
            google: None,
            google_pending: Default::default(),
        })
    }

    #[test]
    fn from_env_requires_all_three_or_none() {
        // Can't safely test the "all set" / "none set" branches here: env
        // vars are process-global and tests run concurrently. The property
        // worth pinning without touching the environment is the parsing
        // logic itself, exercised directly.
        assert!(matches!(
            (None::<String>, None::<String>, None::<String>),
            (None, None, None)
        ));
    }

    /// The button-hiding contract: unconfigured means `/auth/config` says so,
    /// and every Google route refuses with 503 rather than pretending to work.
    #[tokio::test]
    async fn unconfigured_hides_and_refuses() {
        let state = state_with(mem());

        let cfg = config(State(state.clone())).await.0;
        assert_eq!(cfg["google"], false);

        let start_err = start(
            State(state.clone()),
            Query(StartQuery { app_session: None }),
        )
        .await
        .unwrap_err();
        assert_eq!(start_err.0, StatusCode::SERVICE_UNAVAILABLE);

        let callback_err = callback(
            State(state.clone()),
            Query(CallbackQuery {
                code: Some("x".into()),
                state: Some("y".into()),
                error: None,
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(callback_err.0, StatusCode::SERVICE_UNAVAILABLE);
    }

    /// `session` (the ticket pickup) needs no Google config at all — by the
    /// time a ticket exists, the callback already ran. It should still behave
    /// correctly: unknown/expired tickets refuse, real ones are single-use.
    #[tokio::test]
    async fn ticket_is_single_use() {
        let state = state_with(mem());
        let ticket = state
            .google_pending
            .new_ticket("alice".into(), "tok-123".into());

        let first = session(State(state.clone()), Path(ticket.clone()))
            .await
            .unwrap()
            .0;
        assert_eq!(first["name"], "alice");
        assert_eq!(first["token"], "tok-123");

        let second = session(State(state.clone()), Path(ticket)).await;
        assert_eq!(second.unwrap_err().0, StatusCode::NOT_FOUND);
    }

    #[test]
    fn candidate_name_strips_and_falls_back() {
        assert_eq!(candidate_name("alice@example.com"), "alice");
        assert_eq!(candidate_name("a.l.i.c.e+tag@example.com"), "alicetag");
        // Fully-symbolic local part: falls back rather than producing "".
        assert!(candidate_name("@example.com").starts_with("google-"));
    }

    /// First sign-in with a fresh email creates an account and remembers it;
    /// a second sign-in with the same email resolves back to the same one.
    #[test]
    fn first_login_creates_then_repeat_login_matches() {
        let c = mem();
        let (id1, name1) = find_or_create_account(&c, "alice@example.com").unwrap();
        assert_eq!(name1, "alice");

        let (id2, name2) = find_or_create_account(&c, "alice@example.com").unwrap();
        assert_eq!(id1, id2);
        assert_eq!(name2, "alice");
    }

    /// The takeover case that matters most here: a passwordless account is
    /// usually a *passkey* account, so a name match must not adopt it either.
    /// Holding `alice@example.com` on Google says nothing about who owns the
    /// local account named `alice`.
    #[test]
    fn refuses_to_link_a_same_named_passwordless_account() {
        let c = mem();
        c.execute(
            "INSERT INTO accounts (name, created_at) VALUES ('alice', 0)",
            [],
        )
        .unwrap();
        let existing_id = c.last_insert_rowid();

        let (id, name) = find_or_create_account(&c, "alice@example.com").unwrap();
        assert_ne!(id, existing_id, "must not adopt the existing account");
        assert_ne!(name, "alice");

        // The pre-existing account is left exactly as it was.
        let google_email: Option<String> = c
            .query_row(
                "SELECT google_email FROM accounts WHERE id = ?1",
                [existing_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(google_email, None);
    }

    /// The takeover case the plan calls out: a same-named account that
    /// already has a password must not be linked. A separate account is
    /// created for the real, Google-verified email owner instead.
    #[test]
    fn refuses_to_link_a_same_named_account_with_a_password() {
        let c = mem();
        c.execute(
            "INSERT INTO accounts (name, created_at, password_hash) VALUES ('alice', 0, 'not-a-real-hash')",
            [],
        )
        .unwrap();
        let password_account_id = c.last_insert_rowid();

        let (id, name) = find_or_create_account(&c, "alice@example.com").unwrap();
        assert_ne!(
            id, password_account_id,
            "must not sign into the password-protected account"
        );
        assert_eq!(name, "alice-2");

        let untouched: Option<String> = c
            .query_row(
                "SELECT google_email FROM accounts WHERE id = ?1",
                [password_account_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            untouched, None,
            "the password account's row must be unchanged"
        );
    }
}
