//! Storage for the sync bearer token (`sync-server`'s `/sync` credential).
//!
//! Desktop: the OS keyring (service `"albas"`, entry `"sync_token"`). Mobile
//! (Android/iOS): no keyring backend, so the token falls back to the SQLite
//! `settings` table under a dedicated key (app-private storage, sandboxed by
//! the OS, but not encrypted at rest).
//!
//! `sync::TOKEN_SETTING` (`__sync_token`) is *not* used for the secret itself
//! any more — every reader of the real token goes through `get()`/`set()`/
//! `clear()` here instead. That setting is repurposed as a non-secret
//! **marker**: `"1"` once signed in, `""` once signed out, written alongside
//! every `set()`/`clear()` call. `AppContext.tsx`'s `signedIn` check
//! (`!!settings.__sync_token?.trim()`) reads only presence, never the value,
//! so it keeps working completely unchanged — see the Phase E handoff notes
//! for the frontend implication (the settings key genuinely holds a marker
//! now, not a credential; nothing in `src/` needed to change to keep working,
//! but nothing there should ever read it expecting the real token either).

use crate::db::{self, Db};

const KEYRING_SERVICE: &str = "albas";
const KEYRING_USER: &str = "sync_token";
/// The non-secret "am I signed in" marker written to the *same* settings key
/// `sync.rs` used to store the real token under. See the module doc comment.
const MARKER_SETTING: &str = "__sync_token";

/// Writes the non-secret signed-in marker. Called by `set`/`clear` below —
/// never call this on its own, or the marker and the real stored token could
/// disagree about whether anyone is signed in.
fn write_marker(conn: &rusqlite::Connection, signed_in: bool) -> Result<(), String> {
    db::write_setting(conn, MARKER_SETTING, if signed_in { "1" } else { "" }).map_err(|e| e.to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod store {
    use super::{KEYRING_SERVICE, KEYRING_USER};

    pub(super) fn get(_db: &super::Db) -> Option<String> {
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?.get_password().ok()
    }

    pub(super) fn set(_db: &super::Db, token: &str) -> Result<(), String> {
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .map_err(|e| e.to_string())?
            .set_password(token)
            .map_err(|e| e.to_string())
    }

    pub(super) fn clear(_db: &super::Db) -> Result<(), String> {
        match keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
            Ok(entry) => match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(e.to_string()),
            },
            Err(e) => Err(e.to_string()),
        }
    }
}

/// Android/iOS have no keyring backend, so the token lives in the SQLite file
/// under a settings key that is *not* the marker key — the real secret and
/// the "am I signed in" marker are two different rows even here, so a reader
/// that (wrongly) went looking for the token under `MARKER_SETTING` would
/// find `"1"`, not a working credential, rather than something that merely
/// looks like one.
#[cfg(any(target_os = "android", target_os = "ios"))]
mod store {
    use super::Db;
    use crate::db;

    const MOBILE_SECRET_SETTING: &str = "__sync_token_secret";

    pub(super) fn get(dbs: &Db) -> Option<String> {
        let conn = dbs.0.lock().ok()?;
        db::read_setting(&conn, MOBILE_SECRET_SETTING).filter(|s| !s.trim().is_empty())
    }

    pub(super) fn set(dbs: &Db, token: &str) -> Result<(), String> {
        let conn = dbs.0.lock().map_err(|e| e.to_string())?;
        db::write_setting(&conn, MOBILE_SECRET_SETTING, token).map_err(|e| e.to_string())
    }

    pub(super) fn clear(dbs: &Db) -> Result<(), String> {
        let conn = dbs.0.lock().map_err(|e| e.to_string())?;
        db::write_setting(&conn, MOBILE_SECRET_SETTING, "").map_err(|e| e.to_string())
    }
}

/// The signed-in bearer token, or `None`. Never logged, never handed to the
/// frontend — only Rust code that talks to the sync server over `ureq` reads
/// this (see `account.rs`, `sync.rs`).
pub fn get(db: &Db) -> Option<String> {
    store::get(db).filter(|s| !s.trim().is_empty())
}

/// Stores the token and flips the signed-in marker on in the same settings
/// table (best-effort: a marker write failure is surfaced, since a caller
/// that just adopted a session needs to know if `signedIn` won't reflect it).
pub fn set(db: &Db, token: &str) -> Result<(), String> {
    store::set(db, token)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    write_marker(&conn, true)
}

/// Clears the token and flips the signed-in marker off.
pub fn clear(db: &Db) -> Result<(), String> {
    store::clear(db)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    write_marker(&conn, false)
}
