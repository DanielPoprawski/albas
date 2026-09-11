//! TOTP / 2FA.
//!
//! **Enforced on password login only — never on passkey login, and never
//! required to have.** A passkey ceremony is already possession plus user
//! verification (PIN/biometric at the authenticator); bolting a typed code
//! onto that adds friction without adding a factor, and the passkey ceremony
//! runs through the OS authenticator via `tauri-plugin-webauthn`
//! (`src/auth.ts`), which has nowhere to prompt for a code anyway. Password
//! login is the one flow here where a second factor genuinely adds something,
//! so `password::login_password` is the sole caller of `verify_if_enrolled`.
//!
//! Contract:
//!   `GET    /totp`         — authenticated. `{ enrolled, confirmed }` — never
//!                            the secret; that is handed out once, at enrollment.
//!   `POST   /totp/enroll`  — authenticated, body `{ password }` (re-verified —
//!                            see `verify_account_password`). Generates a
//!                            secret, stores it (AES-256-GCM encrypted — see
//!                            "Secret at rest" below) in `accounts.totp_secret`,
//!                            returns the *plaintext* secret and an
//!                            `otpauth://` URI, once. The QR is rendered
//!                            CLIENT-side from that URI; this handler never
//!                            generates an image. Refuses (409) while already
//!                            confirmed — see `enroll_start` for why. Refuses
//!                            (503) when no `ALBAS_SYNC_KEK` is configured.
//!   `POST   /totp/confirm` — authenticated. Verifies the first code, sets
//!                            `accounts.totp_confirmed = 1`, and returns eight
//!                            one-time recovery codes — shown exactly once,
//!                            only their SHA-256 hashes are ever stored.
//!   `DELETE /totp`         — authenticated. Clears the secret, confirmation,
//!                            and any unused recovery codes.
//!
//! Verification uses the `totp-rs` crate throughout (secret generation, URI
//! construction, code checking) rather than hand-rolled HOTP/TOTP math.
//!
//! ## Secret at rest
//!
//! `accounts.totp_secret` never holds the raw base32 secret — it holds
//! `base64(nonce || AES-256-GCM(secret))`, keyed by `ALBAS_SYNC_KEK` (a
//! 32-byte key, base64-encoded in the env var). Without a KEK configured,
//! `enroll_start` refuses outright (503) rather than falling back to
//! plaintext, and if a KEK-encrypted row somehow can't be decrypted (KEK
//! missing, rotated, or corrupted) verification fails closed — a logged
//! server-side error and a generic client-facing failure, never a silent
//! "not enrolled".
//!
//! ## Replay protection
//!
//! Each 30-second step a code was accepted for is recorded in `totp_used`
//! (`account_id`, `step`). A second presentation of a code valid for a step
//! already spent is rejected even though the code itself would still check
//! out — otherwise a code sniffed off the wire (or over someone's shoulder)
//! stays usable for its entire 30-second window.

use crate::AppState;
use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use totp_rs::{Algorithm, Secret, TOTP};

type Rejection = (StatusCode, String);

/// The message the password client matches to know it must ask for a code and
/// retry. Keep this string stable — it is load-bearing for that other flow.
pub(crate) const CODE_REQUIRED: &str = "A two-factor code is required.";
const CODE_WRONG: &str = "That code didn't match. Try again.";
/// A step's replay window: codes from more than this many 30s steps ago are
/// swept out of `totp_used` — comfortably wider than the ±1 step `totp-rs`
/// itself tolerates for clock skew.
const REPLAY_WINDOW_STEPS: i64 = 10;
/// TOTP's own step length: `TOTP::new(..., 30, ...)` below.
const STEP_SECONDS: i64 = 30;

fn internal<E: std::fmt::Display>(e: E) -> Rejection {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

fn unauthorized() -> Rejection {
    (StatusCode::UNAUTHORIZED, "Not signed in.".into())
}

// --- Secret encryption at rest ---

/// Reads and decodes `ALBAS_SYNC_KEK` (32 raw bytes, base64-encoded). `None`
/// when unset, empty, or not exactly 32 bytes after decoding — all treated as
/// "no key available" rather than panicking, so a misconfigured deployment
/// fails closed on this one feature instead of refusing to boot at all.
fn kek() -> Option<[u8; 32]> {
    let raw = std::env::var("ALBAS_SYNC_KEK").ok()?;
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let bytes = B64.decode(raw).ok()?;
    bytes.try_into().ok()
}

/// Encrypts a plaintext base32 TOTP secret for storage. 503s (not 500) when
/// no KEK is configured — this is a deployment gap the operator can fix by
/// setting the env var, not a server bug.
fn encrypt_secret(plain_b32: &str) -> Result<String, Rejection> {
    let Some(key_bytes) = kek() else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "Two-factor authentication is not available on this server: no encryption key \
             is configured (set ALBAS_SYNC_KEK)."
                .into(),
        ));
    };
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ct = cipher
        .encrypt(&nonce, plain_b32.as_bytes())
        .map_err(|e| internal(format!("could not encrypt TOTP secret: {e}")))?;
    let mut out = nonce.to_vec();
    out.extend_from_slice(&ct);
    Ok(B64.encode(out))
}

/// Decrypts a stored secret. Fails closed: any problem (no KEK, bad base64,
/// wrong/rotated key, corrupted row) is logged server-side with detail and
/// returned to the caller as a generic, non-revealing failure — this must
/// never be mistaken by a caller for "not enrolled".
fn decrypt_secret(stored: &str) -> Result<String, Rejection> {
    let fail = || {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "Two-factor verification is temporarily unavailable.".into(),
        )
    };
    let Some(key_bytes) = kek() else {
        tracing::error!("totp: ALBAS_SYNC_KEK is not set but an encrypted TOTP secret exists");
        return Err(fail());
    };
    let raw = B64.decode(stored).map_err(|e| {
        tracing::error!("totp: stored secret is not valid base64: {e}");
        fail()
    })?;
    if raw.len() < 12 {
        tracing::error!("totp: stored secret is too short to contain a nonce");
        return Err(fail());
    }
    let (nonce_bytes, ct) = raw.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let plain = cipher.decrypt(Nonce::from_slice(nonce_bytes), ct).map_err(|e| {
        tracing::error!("totp: failed to decrypt stored secret: {e}");
        fail()
    })?;
    String::from_utf8(plain).map_err(|e| {
        tracing::error!("totp: decrypted secret was not valid UTF-8: {e}");
        fail()
    })
}

/// Rebuilds the `TOTP` verifier from a *decrypted* base32 secret. Issuer and
/// account name only affect the `otpauth://` URI (`get_url`), never
/// `check`/`check_current`, so a placeholder account name is fine here — the
/// real one is only needed once, at `enroll_start`, to build the URI the user
/// actually scans.
fn totp_from_secret(secret_b32: &str) -> Result<TOTP, Rejection> {
    let secret = Secret::Encoded(secret_b32.to_string())
        .to_bytes()
        .map_err(|e| internal(format!("stored TOTP secret is invalid: {e}")))?;
    TOTP::new(Algorithm::SHA1, 6, 1, STEP_SECONDS as u64, secret, None, String::new())
        .map_err(|e| internal(format!("could not rebuild TOTP verifier: {e}")))
}

fn current_step() -> i64 {
    crate::now_ms() / 1000 / STEP_SECONDS
}

/// Rejects (and does *not* record) a code already accepted for this exact
/// step; otherwise records it and sweeps entries outside the replay window.
fn check_and_record_replay(
    conn: &rusqlite::Connection,
    account_id: i64,
    step: i64,
) -> Result<(), Rejection> {
    let already: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM totp_used WHERE account_id = ?1 AND step = ?2",
            params![account_id, step],
            |r| r.get(0),
        )
        .optional()
        .map_err(internal)?;
    if already.is_some() {
        return Err((StatusCode::UNAUTHORIZED, CODE_WRONG.into()));
    }
    conn.execute(
        "INSERT INTO totp_used (account_id, step) VALUES (?1, ?2)",
        params![account_id, step],
    )
    .map_err(internal)?;
    conn.execute("DELETE FROM totp_used WHERE step < ?1", [step - REPLAY_WINDOW_STEPS])
        .map_err(internal)?;
    Ok(())
}

// --- Recovery codes ---

/// Excludes visually ambiguous characters (0/O, 1/l/I) — these are read off a
/// screen and typed back in under stress (locked out, no authenticator).
const RECOVERY_ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";

fn generate_recovery_code() -> String {
    let mut buf = [0u8; 10];
    getrandom::getrandom(&mut buf).expect("OS randomness unavailable");
    let s: String = buf
        .iter()
        .map(|b| RECOVERY_ALPHABET[(*b as usize) % RECOVERY_ALPHABET.len()] as char)
        .collect();
    format!("{}-{}", &s[..5], &s[5..])
}

fn generate_recovery_codes() -> Vec<String> {
    (0..8).map(|_| generate_recovery_code()).collect()
}

/// Case- and punctuation-insensitive so "AB3F9-X7K2Q" and "ab3f9x7k2q" hash
/// identically — a recovery code is typed back in by hand, once, under
/// pressure; the format shouldn't be a second thing that can go wrong.
fn normalize_recovery_code(code: &str) -> String {
    code.chars().filter(|c| c.is_ascii_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

fn hash_recovery_code(code: &str) -> String {
    crate::to_hex(&Sha256::digest(normalize_recovery_code(code).as_bytes()))
}

/// Consumes one unused recovery code for this account, if `code` matches one.
/// Single-use: the matching row's `used_at` is stamped so it can never verify
/// again, recovery-code or otherwise.
fn verify_recovery_code(conn: &rusqlite::Connection, account_id: i64, code: &str) -> Result<(), Rejection> {
    let hash = hash_recovery_code(code);
    let id: Option<i64> = conn
        .query_row(
            "SELECT id FROM recovery_codes WHERE account_id = ?1 AND code_hash = ?2 AND used_at IS NULL",
            params![account_id, hash],
            |r| r.get(0),
        )
        .optional()
        .map_err(internal)?;
    let Some(id) = id else {
        return Err((StatusCode::UNAUTHORIZED, CODE_WRONG.into()));
    };
    conn.execute("UPDATE recovery_codes SET used_at = ?1 WHERE id = ?2", params![crate::now_ms(), id])
        .map_err(internal)?;
    Ok(())
}

/// The seam between TOTP and any login flow that wants it as a second factor.
///
/// Called by `password::login_password` after the password itself verifies.
/// Contract, which the password flow codes against and must keep working:
///   - account has no confirmed TOTP  -> `Ok(())`, `code`/`recovery_code` ignored;
///   - confirmed TOTP and `recovery_code` matches an unused code -> `Ok(())`,
///     that code is burned;
///   - confirmed TOTP, no recovery code, and `code` verifies -> `Ok(())`;
///   - confirmed TOTP and both missing  -> `Err((UNAUTHORIZED, CODE_REQUIRED))`;
///   - confirmed TOTP and `code`/`recovery_code` wrong, replayed, or the
///     account is locked out -> `Err(...)` (401 or 423 — see `lockout.rs`).
///
/// An account with a secret that was never confirmed (an abandoned or
/// in-progress enrollment) is treated the same as no secret at all — a
/// half-finished enrollment must never lock anyone out of password login.
pub(crate) fn verify_if_enrolled(
    conn: &rusqlite::Connection,
    account_id: i64,
    code: Option<&str>,
    recovery_code: Option<&str>,
) -> Result<(), Rejection> {
    let row: Option<(Option<String>, i64)> = conn
        .query_row(
            "SELECT totp_secret, totp_confirmed FROM accounts WHERE id = ?1",
            [account_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(internal)?;
    let Some((Some(secret_enc), confirmed)) = row else {
        return Ok(());
    };
    if confirmed == 0 {
        return Ok(());
    }

    if let Some(rc) = recovery_code.map(str::trim).filter(|c| !c.is_empty()) {
        crate::lockout::check(conn, account_id, "totp")?;
        return match verify_recovery_code(conn, account_id, rc) {
            Ok(()) => {
                crate::lockout::reset(conn, account_id, "totp")?;
                Ok(())
            }
            Err(e) => {
                crate::lockout::record_failure(conn, account_id, "totp")?;
                Err(e)
            }
        };
    }

    let Some(code) = code.map(str::trim).filter(|c| !c.is_empty()) else {
        return Err((StatusCode::UNAUTHORIZED, CODE_REQUIRED.into()));
    };

    crate::lockout::check(conn, account_id, "totp")?;
    let secret_b32 = decrypt_secret(&secret_enc)?;
    let totp = totp_from_secret(&secret_b32)?;
    let ok = totp.check_current(code).map_err(internal)?;
    if !ok {
        crate::lockout::record_failure(conn, account_id, "totp")?;
        return Err((StatusCode::UNAUTHORIZED, CODE_WRONG.into()));
    }
    if let Err(e) = check_and_record_replay(conn, account_id, current_step()) {
        crate::lockout::record_failure(conn, account_id, "totp")?;
        return Err(e);
    }
    crate::lockout::reset(conn, account_id, "totp")?;
    Ok(())
}

pub(crate) async fn totp_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, Rejection> {
    let guard = state.conn.lock().map_err(internal)?;
    let account_id = crate::account_for(&guard, &headers).ok_or_else(unauthorized)?;
    let (enrolled, confirmed): (bool, bool) = guard
        .query_row(
            "SELECT totp_secret IS NOT NULL, totp_confirmed != 0 FROM accounts WHERE id = ?1",
            [account_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(internal)?;
    Ok(Json(json!({ "enrolled": enrolled, "confirmed": confirmed })))
}

#[derive(Deserialize)]
pub(crate) struct EnrollReq {
    /// Re-verified before minting a new secret — see the module doc comment
    /// on `enroll_start`'s route.
    password: String,
}

/// Starts (or restarts) enrollment. Requires the account's current password
/// again: a bearer token alone proves "some session for this account",
/// which might be a stolen one — re-typing the password is the same "prove
/// you're still you" step every other sensitive action here asks for.
///
/// Re-enrolling while already **confirmed** is refused with 409 rather than
/// silently overwriting the secret: TOTP is a second factor for password
/// login, and letting a live enrollment endpoint swap out a confirmed secret
/// would mean anyone who can reach it with a valid bearer token (any device
/// signed into the account, not just the one that set 2FA up) could silently
/// mint themselves a new secret and QR, bypassing the "prove you have the old
/// code" step disabling+re-enrolling would require. Turn it off first
/// (`DELETE /totp`), then enroll again. Restarting an **unconfirmed**
/// enrollment (an abandoned attempt) is fine and just overwrites the pending
/// secret — nothing depends on it yet.
pub(crate) async fn enroll_start(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<EnrollReq>,
) -> Result<Json<Value>, Rejection> {
    let guard = state.conn.lock().map_err(internal)?;
    let account_id = crate::account_for(&guard, &headers).ok_or_else(unauthorized)?;
    crate::password::verify_account_password(&guard, account_id, &body.password)?;
    let (name, confirmed): (String, i64) = guard
        .query_row(
            "SELECT name, totp_confirmed FROM accounts WHERE id = ?1",
            [account_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(internal)?;
    if confirmed != 0 {
        return Err((
            StatusCode::CONFLICT,
            "Two-factor authentication is already turned on. Turn it off before setting it up again."
                .into(),
        ));
    }
    let secret = Secret::generate_secret();
    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        STEP_SECONDS as u64,
        secret.to_bytes().map_err(internal)?,
        Some("Albas".to_string()),
        name,
    )
    .map_err(|e| internal(format!("could not build TOTP: {e}")))?;
    let secret_b32 = totp.get_secret_base32();
    let uri = totp.get_url();
    let stored = encrypt_secret(&secret_b32)?;
    guard
        .execute("UPDATE accounts SET totp_secret = ?1 WHERE id = ?2", params![stored, account_id])
        .map_err(internal)?;
    Ok(Json(json!({ "secret": secret_b32, "uri": uri })))
}

#[derive(Deserialize)]
pub(crate) struct ConfirmReq {
    code: String,
}

pub(crate) async fn enroll_confirm(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<ConfirmReq>,
) -> Result<Json<Value>, Rejection> {
    let guard = state.conn.lock().map_err(internal)?;
    let account_id = crate::account_for(&guard, &headers).ok_or_else(unauthorized)?;
    let secret_enc: Option<String> = guard
        .query_row("SELECT totp_secret FROM accounts WHERE id = ?1", [account_id], |r| r.get(0))
        .map_err(internal)?;
    let Some(secret_enc) = secret_enc else {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "Start enrollment before confirming a code.".into(),
        ));
    };
    let secret_b32 = decrypt_secret(&secret_enc)?;
    let totp = totp_from_secret(&secret_b32)?;
    let code = body.code.trim();
    let ok = totp.check_current(code).map_err(internal)?;
    if !ok {
        return Err((StatusCode::UNAUTHORIZED, CODE_WRONG.into()));
    }
    guard
        .execute("UPDATE accounts SET totp_confirmed = 1 WHERE id = ?1", [account_id])
        .map_err(internal)?;

    // Fresh codes replace any left over from a previous enrollment.
    guard
        .execute("DELETE FROM recovery_codes WHERE account_id = ?1", [account_id])
        .map_err(internal)?;
    let codes = generate_recovery_codes();
    let now = crate::now_ms();
    for c in &codes {
        guard
            .execute(
                "INSERT INTO recovery_codes (account_id, code_hash, created_at) VALUES (?1, ?2, ?3)",
                params![account_id, hash_recovery_code(c), now],
            )
            .map_err(internal)?;
    }

    Ok(Json(json!({ "confirmed": true, "recoveryCodes": codes })))
}

pub(crate) async fn disable_totp(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, Rejection> {
    let guard = state.conn.lock().map_err(internal)?;
    let account_id = crate::account_for(&guard, &headers).ok_or_else(unauthorized)?;
    guard
        .execute(
            "UPDATE accounts SET totp_secret = NULL, totp_confirmed = 0 WHERE id = ?1",
            [account_id],
        )
        .map_err(internal)?;
    guard
        .execute("DELETE FROM recovery_codes WHERE account_id = ?1", [account_id])
        .map_err(internal)?;
    guard
        .execute("DELETE FROM totp_used WHERE account_id = ?1", [account_id])
        .map_err(internal)?;
    Ok(Json(json!({ "disabled": true })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// Serializes every test below that reads or writes `ALBAS_SYNC_KEK` —
    /// `cargo test` runs tests in parallel by default and env vars are
    /// process-global (the same caveat `google.rs`'s tests document for
    /// their own env vars), so two such tests running concurrently would
    /// race. Every test that touches this var acquires the lock for its
    /// *entire* body (an async test holds it directly rather than through a
    /// higher-order function, since dropping it early — e.g. right after
    /// constructing but before awaiting a future — would defeat the point).
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn set_test_kek() {
        // SAFETY: test-only, and the caller holds `ENV_LOCK` for as long as
        // this value matters.
        unsafe { std::env::set_var("ALBAS_SYNC_KEK", B64.encode([7u8; 32])) };
    }

    /// Tests that exercise real crypto need a KEK in the environment; process
    /// env vars are shared across the whole test binary, so every such test
    /// sets the same fixed key rather than relying on load order.
    fn with_kek<T>(f: impl FnOnce() -> T) -> T {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        set_test_kek();
        f()
    }

    fn mem() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        crate::init_db(&mut c, None).unwrap();
        c
    }

    fn add_account(c: &Connection, name: &str) -> i64 {
        c.execute("INSERT INTO accounts (name, created_at) VALUES (?1, 0)", [name]).unwrap();
        c.last_insert_rowid()
    }

    fn store_secret(c: &Connection, id: i64, secret_b32: &str) {
        let stored = encrypt_secret(secret_b32).unwrap();
        c.execute("UPDATE accounts SET totp_secret = ?1 WHERE id = ?2", params![stored, id]).unwrap();
    }

    /// Generates a code from the same secret+time totp-rs itself would use, so
    /// tests exercise real verification rather than a hardcoded digit string.
    fn code_for(secret_b32: &str) -> String {
        totp_from_secret(secret_b32).unwrap().generate_current().unwrap()
    }

    #[test]
    fn encrypt_decrypt_round_trips_and_fails_closed_without_a_kek() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        set_test_kek();

        let enc = encrypt_secret("JBSWY3DPEHPK3PXP").unwrap();
        assert_ne!(enc, "JBSWY3DPEHPK3PXP", "must not store the secret in the clear");
        assert_eq!(decrypt_secret(&enc).unwrap(), "JBSWY3DPEHPK3PXP");

        // SAFETY: test-only; still holding ENV_LOCK.
        unsafe { std::env::remove_var("ALBAS_SYNC_KEK") };
        assert_eq!(
            encrypt_secret("JBSWY3DPEHPK3PXP").unwrap_err().0,
            StatusCode::SERVICE_UNAVAILABLE,
            "enrollment must refuse rather than store a plaintext secret"
        );
    }

    #[test]
    fn recovery_codes_are_case_and_dash_insensitive_and_single_use() {
        with_kek(|| {
            let c = mem();
            let id = add_account(&c, "sarah");
            let code = generate_recovery_code();
            c.execute(
                "INSERT INTO recovery_codes (account_id, code_hash, created_at) VALUES (?1, ?2, 0)",
                params![id, hash_recovery_code(&code)],
            )
            .unwrap();

            let typed_loose = code.to_uppercase().replace('-', " ");
            assert!(verify_recovery_code(&c, id, &typed_loose).is_ok());

            // Second use of the same code must fail — it was burned.
            let err = verify_recovery_code(&c, id, &code).unwrap_err();
            assert_eq!(err.0, StatusCode::UNAUTHORIZED);
        });
    }

    #[test]
    fn unenrolled_account_passes_through() {
        let c = mem();
        let id = add_account(&c, "sarah");
        assert!(verify_if_enrolled(&c, id, None, None).is_ok());
        assert!(verify_if_enrolled(&c, id, Some("000000"), None).is_ok());
    }

    #[test]
    fn unconfirmed_enrollment_does_not_gate_login() {
        with_kek(|| {
            let c = mem();
            let id = add_account(&c, "sarah");
            store_secret(&c, id, "JBSWY3DPEHPK3PXP");
            // totp_confirmed is still 0 — an abandoned enrollment must not lock
            // out password login.
            assert!(verify_if_enrolled(&c, id, None, None).is_ok());
        });
    }

    #[test]
    fn enroll_then_confirm_then_verify_accepts_a_generated_code_once() {
        with_kek(|| {
            let c = mem();
            let id = add_account(&c, "sarah");
            let secret = Secret::generate_secret();
            let totp_rs::Secret::Encoded(secret_b32) = secret.to_encoded() else { unreachable!() };
            store_secret(&c, id, &secret_b32);

            // Not confirmed yet: still passes through with no code.
            assert!(verify_if_enrolled(&c, id, None, None).is_ok());
            c.execute("UPDATE accounts SET totp_confirmed = 1 WHERE id = ?1", [id]).unwrap();

            let code = code_for(&secret_b32);
            assert!(verify_if_enrolled(&c, id, Some(&code), None).is_ok());

            // Replaying the exact same code within its own step must fail even
            // though the code is still numerically correct.
            let err = verify_if_enrolled(&c, id, Some(&code), None).unwrap_err();
            assert_eq!(err.0, StatusCode::UNAUTHORIZED);
        });
    }

    #[test]
    fn confirmed_totp_rejects_wrong_code_and_locks_out_after_ten() {
        with_kek(|| {
            let c = mem();
            let id = add_account(&c, "sarah");
            let secret = Secret::generate_secret();
            let secret_b32 = match secret.to_encoded() {
                Secret::Encoded(s) => s,
                _ => unreachable!(),
            };
            store_secret(&c, id, &secret_b32);
            c.execute("UPDATE accounts SET totp_confirmed = 1 WHERE id = ?1", [id]).unwrap();

            let real = code_for(&secret_b32);
            let mut wrong: Vec<char> = real.chars().collect();
            let d = wrong[0].to_digit(10).unwrap();
            wrong[0] = std::char::from_digit((d + 1) % 10, 10).unwrap();
            let wrong: String = wrong.into_iter().collect();
            assert_ne!(wrong, real);

            // Ten wrong attempts, each individually a plain 401 — the account
            // only becomes locked out *after* the 10th is recorded.
            for _ in 0..10 {
                let err = verify_if_enrolled(&c, id, Some(&wrong), None).unwrap_err();
                assert_eq!(err.0, StatusCode::UNAUTHORIZED);
            }

            // The 11th attempt is refused as locked before the code is even
            // looked at — even the *correct* code is refused while locked out.
            let err = verify_if_enrolled(&c, id, Some(&real), None).unwrap_err();
            assert_eq!(err.0, StatusCode::LOCKED, "11th attempt must see the lockout from the 10th failure");
        });
    }

    #[test]
    fn confirmed_totp_requires_a_code_or_recovery_code() {
        with_kek(|| {
            let c = mem();
            let id = add_account(&c, "sarah");
            let secret = Secret::generate_secret();
            let secret_b32 = match secret.to_encoded() {
                Secret::Encoded(s) => s,
                _ => unreachable!(),
            };
            store_secret(&c, id, &secret_b32);
            c.execute("UPDATE accounts SET totp_confirmed = 1 WHERE id = ?1", [id]).unwrap();

            let err = verify_if_enrolled(&c, id, None, None).unwrap_err();
            assert_eq!(err.0, StatusCode::UNAUTHORIZED);
            assert_eq!(err.1, CODE_REQUIRED);

            let err = verify_if_enrolled(&c, id, Some(""), None).unwrap_err();
            assert_eq!(err.1, CODE_REQUIRED);
        });
    }

    fn headers_for(token: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("authorization", format!("Bearer {token}").parse().unwrap());
        h
    }

    fn state_with(c: Connection) -> Arc<AppState> {
        Arc::new(AppState {
            conn: std::sync::Mutex::new(c),
            signups: crate::Signups::Open,
            webauthn: None,
            assetlinks: None,
            pending: Default::default(),
            google: None,
            google_pending: Default::default(),
        })
    }

    /// End-to-end through the real handlers: enroll (with password
    /// re-verification), confirm with a code generated from the returned
    /// secret (receiving recovery codes), check `/totp`, sign in with one of
    /// those recovery codes in place of a TOTP code, and re-enroll.
    #[tokio::test]
    // Held for the whole async body, not via `with_kek` — that helper would
    // drop the guard right after constructing this future, before any of it
    // actually runs. `#[tokio::test]` defaults to a current-thread runtime,
    // so a non-`Send` `std::sync::MutexGuard` living across `.await` points
    // here is fine — nothing ever moves this future to another thread.
    #[allow(clippy::await_holding_lock)]
    async fn enroll_confirm_recovery_and_reenroll_via_handlers() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        set_test_kek();
        {
            let c = mem();
            let id = add_account(&c, "sarah");
            c.execute(
                "UPDATE accounts SET password_hash = ?1 WHERE id = ?2",
                params![crate::password::hash_password("CorrectHorseBattery1").unwrap(), id],
            )
            .unwrap();
            let token = crate::mint_token(&c, id, "device").unwrap();
            let headers = headers_for(&token);
            let state = state_with(c);

            let status = totp_status(State(state.clone()), headers.clone()).await.unwrap().0;
            assert_eq!(status["enrolled"], false);

            let wrong_password = enroll_start(
                State(state.clone()),
                headers.clone(),
                Json(EnrollReq { password: "not-it".into() }),
            )
            .await;
            assert_eq!(wrong_password.unwrap_err().0, StatusCode::UNAUTHORIZED);

            let enrolled = enroll_start(
                State(state.clone()),
                headers.clone(),
                Json(EnrollReq { password: "CorrectHorseBattery1".into() }),
            )
            .await
            .unwrap()
            .0;
            let secret_b32 = enrolled["secret"].as_str().unwrap().to_string();
            let uri = enrolled["uri"].as_str().unwrap();
            assert!(uri.starts_with("otpauth://totp/"));
            assert!(uri.contains(&secret_b32));

            let status = totp_status(State(state.clone()), headers.clone()).await.unwrap().0;
            assert_eq!(status["enrolled"], true);
            assert_eq!(status["confirmed"], false);

            let bad = enroll_confirm(
                State(state.clone()),
                headers.clone(),
                Json(ConfirmReq { code: "000000".into() }),
            )
            .await;
            assert!(bad.is_err());

            let code = code_for(&secret_b32);
            let confirmed =
                enroll_confirm(State(state.clone()), headers.clone(), Json(ConfirmReq { code }))
                    .await
                    .unwrap()
                    .0;
            assert_eq!(confirmed["confirmed"], true);
            let codes: Vec<String> = confirmed["recoveryCodes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
                .collect();
            assert_eq!(codes.len(), 8);

            // A recovery code stands in for a TOTP code at login.
            {
                let guard = state.conn.lock().unwrap();
                assert!(verify_if_enrolled(&guard, id, None, Some(&codes[0])).is_ok());
                // Single-use.
                assert!(verify_if_enrolled(&guard, id, None, Some(&codes[0])).is_err());
            }

            let err = enroll_start(
                State(state.clone()),
                headers.clone(),
                Json(EnrollReq { password: "CorrectHorseBattery1".into() }),
            )
            .await
            .unwrap_err();
            assert_eq!(err.0, StatusCode::CONFLICT);

            let _ = disable_totp(State(state.clone()), headers.clone()).await.unwrap();
            let status = totp_status(State(state.clone()), headers.clone()).await.unwrap().0;
            assert_eq!(status["enrolled"], false);
            assert!(enroll_start(
                State(state),
                headers,
                Json(EnrollReq { password: "CorrectHorseBattery1".into() })
            )
            .await
            .is_ok());
        }
    }
}
