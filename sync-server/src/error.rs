//! The one error shape every handler returns: `(status, message)`, which
//! axum renders as a plain-text body. `web/src/lib/api.ts` and the app's
//! `apiRequest()` both read it that way, so no handler returns a bare
//! `StatusCode` any more.

use axum::http::StatusCode;

pub(crate) type Rejection = (StatusCode, String);

/// A failure the caller can do nothing about — a database, crypto or thread
/// error. The detail goes to the server log; the client sees one generic
/// line, so a rusqlite message can never leak a file path or schema detail.
pub(crate) fn internal(e: impl std::fmt::Display) -> Rejection {
    tracing::error!("internal error: {e}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Something went wrong on the server.".into(),
    )
}

pub(crate) fn unauthorized() -> Rejection {
    (StatusCode::UNAUTHORIZED, "Not signed in.".into())
}
