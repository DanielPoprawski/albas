//! Albas sync endpoint.
//!
//! Deliberately knows nothing about todos or events: it is a generic
//! `(account, table, pk) -> payload` store. Every row carries the client's
//! `updated_at` (for last-write-wins) and a server-assigned `seq` (for the pull
//! watermark). Adding a column to the app schema therefore needs no change here.
//!
//! Accounts: each person owns an isolated row set. A bearer token *is* the
//! identity — `auth::Authed` maps it to an account through the `tokens` table
//! (one row per device/login, only SHA-256 hashes stored). Tokens are minted
//! by password login/registration (`password.rs`), passkey login
//! (`passkey.rs`), Google sign-in (`google.rs`), the browser → app handoff
//! (`app_session.rs`), `albas-sync admin account create` (`admin.rs`), and the
//! `ALBAS_SYNC_TOKEN` env var (which owns the `owner` account's `env`-labelled
//! token, rotating with the var as it always did).
//!
//! Sharing: `shares` grants another account read-only access to table groups
//! (`calendar` = events+periods+categories, `todos` = habits+completions+tasks+
//! categories — the server can't split todos from habits because it never
//! parses payloads). `/sync` returns shared rows alongside the account's own;
//! `accounts.grant_rev` is bumped on every grant change so a client can detect
//! that its shared snapshot is stale and rebuild from zero.
//!
//! Why two clocks: `updated_at` comes from whichever device made the edit, so
//! it is only as good as that device's clock — fine for deciding which of two
//! edits wins. `seq` is assigned here, strictly increasing, and is what clients
//! resume from, so a wrong device clock can never make a client skip a row.
//!
//! Administration is a CLI, not HTTP: `albas-sync admin …` (`admin.rs`) opens
//! the same SQLite file and calls the `*_db` functions in `admin_db.rs`
//! directly, so there is no admin bearer token and no `/admin/*` route surface
//! to protect. The self-service `/shares` trio is still scoped to whichever
//! account the bearer token identifies; the CLI's `share set <owner>
//! <grantee>` names the pair explicitly instead. Anything the CLI does not
//! cover is a `sqlite3` session against the database (`scripts/admin.sh --sql`).
//!
//! **Invites are not getting further admin support.** The product direction
//! (2026-08) is open signup only — anyone with the site link can create an
//! account — so there is deliberately no invite listing or revoke command.
//! `albas-sync admin invite create` (`passkey::create_invite_db`) still exists
//! for `ALBAS_SYNC_SIGNUPS=invite` deployments and for attaching a passkey to
//! an existing account. See root `CLAUDE.md`, "Project direction".
//!
//! Layout: this file is the process — configuration in, router out. `auth.rs`
//! owns tokens and the `Authed` extractor, `error.rs` the one `Rejection`
//! shape every handler returns, `schema.rs` the tables and the upgrade path,
//! `config.rs` every environment variable; the rest is one module per route
//! group.

mod account;
mod admin;
mod admin_db;
mod app_session;
mod auth;
mod config;
mod error;
mod google;
mod lockout;
mod passkey;
mod password;
mod schema;
mod shares;
mod sync;
mod tokens;
mod totp;

use axum::{
    routing::{delete, get, post, put},
    Router,
};
use rusqlite::Connection;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tower_governor::{
    errors::GovernorError, governor::GovernorConfigBuilder, key_extractor::KeyExtractor,
    GovernorLayer,
};

use crate::config::{Config, Signups};
use crate::error::{internal, Rejection};

pub(crate) struct AppState {
    pub(crate) conn: Mutex<Connection>,
    pub(crate) signups: Signups,
    pub(crate) webauthn: Option<webauthn_rs::Webauthn>,
    pub(crate) assetlinks: Option<String>,
    /// The TOTP secret-at-rest key (`Config::kek`); `None` = enrollment 503s.
    pub(crate) kek: Option<[u8; 32]>,
    pub(crate) pending: passkey::Pending,
    pub(crate) google: Option<google::GoogleConfig>,
    pub(crate) google_pending: google::Pending,
}

impl AppState {
    /// Runs `f` against the database on tokio's blocking pool, holding the
    /// connection lock only for the closure. Every handler's SQLite and
    /// Argon2 work goes through here, so a slow verify or a busy-timeout wait
    /// never stalls an async worker that other requests need.
    pub(crate) async fn db<T, F>(self: &Arc<Self>, f: F) -> Result<T, Rejection>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> Result<T, Rejection> + Send + 'static,
    {
        let state = Arc::clone(self);
        tokio::task::spawn_blocking(move || {
            // A panic inside an earlier closure poisons the lock; the
            // connection itself is fine (SQLite rolled that statement back),
            // so keep serving rather than 500 every request from then on.
            let mut conn = state.conn.lock().unwrap_or_else(|e| e.into_inner());
            f(&mut conn)
        })
        .await
        .map_err(internal)?
    }

    /// Open signups, no passkeys, no Google, no KEK: what a handler test
    /// starts from, with struct update syntax for the one field it needs.
    #[cfg(test)]
    pub(crate) fn for_test(conn: Connection) -> AppState {
        AppState {
            conn: Mutex::new(conn),
            signups: Signups::Open,
            webauthn: None,
            assetlinks: None,
            kek: None,
            pending: Default::default(),
            google: None,
            google_pending: Default::default(),
        }
    }
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn main() -> std::process::ExitCode {
    // Subcommands run synchronously against the database file and never
    // start the server: `admin` is the operator CLI (see `admin.rs`), `health`
    // is what the container healthcheck calls (the image has no curl). No
    // argument at all means "be the server", which is what `CMD` in the
    // Dockerfile does.
    let mut argv = std::env::args();
    match argv.nth(1).as_deref() {
        None => {}
        Some("admin") => return admin::run(argv),
        Some("health") => return admin::health(),
        Some(other) => {
            eprintln!("albas-sync: unknown argument '{other}'\n\n{USAGE}");
            return std::process::ExitCode::from(2);
        }
    }
    let served = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime")
        .block_on(serve());
    match served {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("albas-sync: {e}");
            std::process::ExitCode::FAILURE
        }
    }
}

const USAGE: &str = "usage: albas-sync           run the sync server
       albas-sync admin …   operator CLI (`albas-sync admin --help`)
       albas-sync health    exit 0 if the local server answers /health";

async fn serve() -> Result<(), String> {
    // `RUST_LOG` filters (default `info`); TraceLayer below logs one line per
    // request. Compact single-line output, since this goes to `docker logs`.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .compact()
        .init();

    let cfg = Config::from_env()?;
    let webauthn = passkey::build_webauthn(cfg.origin.as_deref(), cfg.android_origin.as_deref())?;
    let conn = schema::open(&cfg.db_path, cfg.owner_token.as_deref())?;

    let n_accounts: i64 = conn
        .query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if n_accounts == 0 && webauthn.is_none() && cfg.owner_token.is_none() {
        return Err(format!(
            "no accounts exist and no way to create one: set ALBAS_SYNC_ORIGIN (to enable \
             passkey signup) or ALBAS_SYNC_TOKEN (which becomes the '{}' account), or \
             create one from a shell with `albas-sync admin account create <name>`",
            schema::OWNER
        ));
    }

    let state = Arc::new(AppState {
        conn: Mutex::new(conn),
        signups: cfg.signups,
        webauthn,
        assetlinks: cfg.assetlinks,
        kek: cfg.kek,
        pending: passkey::Pending::default(),
        google: cfg.google,
        google_pending: google::Pending::default(),
    });

    let listener = tokio::net::TcpListener::bind(&cfg.addr)
        .await
        .map_err(|e| format!("cannot bind {}: {e}", cfg.addr))?;
    tracing::info!(addr = %cfg.addr, db = %cfg.db_path, "albas-sync listening");
    axum::serve(
        listener,
        app(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .map_err(|e| e.to_string())
}

/// Largest request body accepted, in bytes. Keep equal to
/// `client_max_body_size` in nginx/tls.conf — whichever is smaller wins.
const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;

/// The whole route table. Must be built inside a tokio runtime (the rate
/// limiters spawn their sweep tasks here).
fn app(state: Arc<AppState>) -> Router {
    // Per-IP rate limiting, applied only to the auth-adjacent routes an
    // unauthenticated caller can hammer: login/register (credential guessing
    // and account-name enumeration), TOTP (code guessing — the per-account
    // lockout in `lockout.rs` is the second, tighter layer under this one),
    // and the Google handoff (ticket guessing). `/sync` and the rest need no
    // IP limit — they already require a valid bearer token, which is the
    // actual scarce resource there.
    //
    // A per-IP limiter allowing one request every `seconds_per_token` seconds
    // sustained, with `burst` in hand. Also starts the sweep that keeps its
    // per-key table from growing by one entry per distinct IP forever. (A
    // closure, not a fn: the config's concrete type is private to the crate.)
    let governor = |seconds_per_token: u64, burst: u32| {
        let conf = Arc::new(
            GovernorConfigBuilder::default()
                .key_extractor(RealIpKeyExtractor)
                .per_second(seconds_per_token)
                .burst_size(burst)
                .finish()
                .expect("valid governor config"),
        );
        let limiter = conf.limiter().clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(300));
            loop {
                tick.tick().await;
                limiter.retain_recent();
            }
        });
        conf
    };
    // 10/min sustained with a burst of 20 — mirrored by nginx's `auth` zone.
    let auth_limit = governor(6, 20);
    // The app-session handoff is polled by design (`useBrowserSignIn` asks
    // every few seconds for up to five minutes), so it gets its own, looser
    // bucket: sharing the auth one let a single pending sign-in drain the
    // budget the browser on the same IP needed for `/login/password`. The
    // nonce is 256 random bits, so the looser limit costs nothing against
    // guessing. Mirrored by nginx's `poll` zone.
    let poll_limit = governor(2, 30);

    let rate_limited = Router::new()
        .route("/register/start", post(passkey::register_start))
        .route("/register/finish", post(passkey::register_finish))
        .route("/register/password", post(password::register_password))
        .route("/login/start", post(passkey::login_start))
        .route("/login/finish", post(passkey::login_finish))
        .route("/login/password", post(password::login_password))
        .route("/totp", get(totp::totp_status).delete(totp::disable_totp))
        .route("/totp/enroll", post(totp::enroll_start))
        .route("/totp/confirm", post(totp::enroll_confirm))
        .route("/auth/google/start", get(google::start))
        .route("/auth/google/callback", get(google::callback))
        .route("/auth/google/session/:ticket", get(google::session))
        .layer(GovernorLayer { config: auth_limit });
    let polled = Router::new()
        .route("/app-session", post(app_session::create))
        .route("/app-session/claim", post(app_session::claim))
        .route("/app-session/:nonce", get(app_session::poll))
        .layer(GovernorLayer { config: poll_limit });

    Router::new()
        .merge(rate_limited)
        .merge(polled)
        .route("/health", get(|| async { "ok" }))
        .route("/sync", post(sync::sync))
        .route("/shares", get(shares::shares_get))
        .route(
            "/shares/:name",
            put(shares::shares_put).delete(shares::shares_delete),
        )
        .route(
            "/tokens",
            get(tokens::tokens_list).delete(tokens::tokens_delete_others),
        )
        .route("/tokens/current", delete(tokens::tokens_delete_current))
        .route("/tokens/:id", delete(tokens::tokens_delete_one))
        .route("/account", delete(account::self_delete_account))
        .route("/account/export", get(account::account_export))
        .route("/auth/config", get(google::config))
        .route("/passkeys", get(passkey::list_passkeys))
        .route("/passkeys/start", post(passkey::add_passkey_start))
        .route("/passkeys/finish", post(passkey::add_passkey_finish))
        .route(
            "/password",
            get(password::password_status)
                .put(password::set_password)
                .delete(password::clear_password),
        )
        .route("/.well-known/assetlinks.json", get(passkey::assetlinks))
        // axum's `Json` extractor stops at 2 MB by default. A device's first
        // push after sign-in is its whole history in one request, so match
        // nginx's `client_max_body_size` instead of 413-ing that device
        // forever. `Router::layer` only wraps the routes already added, which
        // is why this sits after `/sync` and not before it.
        .layer(axum::extract::DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state)
}

/// Rate-limit key: the client IP as nginx reports it in `X-Real-IP` (which
/// it *sets*, overwriting anything the client sent — see nginx/tls.conf),
/// falling back to the TCP peer for a bare `cargo run`. Deliberately not
/// tower_governor's `SmartIpKeyExtractor`: that prefers the *first*
/// `X-Forwarded-For` entry, and nginx appends to whatever XFF the client
/// already carried, so a request with a made-up XFF got a fresh bucket every
/// time. The trade-off is that a client talking to the server directly,
/// with no proxy in front, can spoof `X-Real-IP` — the README makes the TLS
/// proxy mandatory for exactly this kind of reason.
#[derive(Clone)]
struct RealIpKeyExtractor;

impl KeyExtractor for RealIpKeyExtractor {
    type Key = std::net::IpAddr;

    fn extract<T>(&self, req: &axum::http::Request<T>) -> Result<Self::Key, GovernorError> {
        req.headers()
            .get("x-real-ip")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse().ok())
            .or_else(|| {
                req.extensions()
                    .get::<axum::extract::ConnectInfo<SocketAddr>>()
                    .map(|c| c.0.ip())
            })
            .ok_or(GovernorError::UnableToExtractKey)
    }
}

#[cfg(test)]
mod tests;
