//! TOTP / 2FA.
//!
//! **Enforced on password login only — never on passkey login, and never
//! required to have.** A passkey ceremony is already possession plus user
//! verification (PIN/biometric at the authenticator); bolting a typed code
//! onto that adds friction without adding a factor, and the passkey ceremony
//! runs in the system browser (`web/`), which has nowhere to prompt the app
//! for a code anyway. Password login is the one flow here where a second
//! factor genuinely adds something, so `password::login_password` is the sole
//! caller of `verify_if_enrolled`.
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
//! `base64(nonce || AES-256-GCM(secret))`, keyed by `ALBAS_SYNC_KEK`
//! (`Config::kek`, held on `AppState`). Without a KEK configured,
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

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use axum::{extract::State, http::StatusCode, Json};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use totp_rs::{Algorithm, Secret, TOTP};

use crate::auth::{to_hex, Authed};
use crate::error::{internal, Rejection};
use crate::{lockout, now_ms, password, AppState};

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

/// The secret-at-rest key, as `AppState` carries it.
type Kek = Option<[u8; 32]>;

// --- Secret encryption at rest ---

/// Encrypts a plaintext base32 TOTP secret for storage. 503s (not 500) when
/// no KEK is configured — this is a deployment gap the operator can fix by
/// setting the env var, not a server bug.
fn encrypt_secret(kek: Kek, plain_b32: &str) -> Result<String, Rejection> {
    let Some(key_bytes) = kek else {
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
fn decrypt_secret(kek: Kek, stored: &str) -> Result<String, Rejection> {
    let fail = || {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "Two-factor verification is temporarily unavailable.".into(),
        )
    };
    let Some(key_bytes) = kek else {
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
    let plain = cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ct)
        .map_err(|e| {
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
    TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        STEP_SECONDS as u64,
        secret,
        None,
        String::new(),
    )
    .map_err(|e| internal(format!("could not rebuild TOTP verifier: {e}")))
}

fn current_step() -> i64 {
    now_ms() / 1000 / STEP_SECONDS
}

/// Length-then-bytes comparison that does not short-circuit on the first
/// differing digit, matching what `totp-rs`'s own `check` does internally.
fn ct_eq(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

/// The step, within the ±1 skew `totp_from_secret` configures, whose code is
/// `code` — or `None` when it matches nothing. Resolved explicitly so the
/// replay record is keyed on the step the code *belongs to*: recording the
/// current step instead let a code minted for step N be accepted again at
/// N+1 and N+2, since `totp-rs` still tolerated it then and `totp_used` only
/// held N.
fn matching_step(totp: &TOTP, code: &str) -> Option<i64> {
    let now = current_step();
    (now - 1..=now + 1).find(|step| ct_eq(&totp.generate((*step * STEP_SECONDS) as u64), code))
}

/// Rejects (and does *not* record) a code already accepted for this exact
/// step; otherwise records it and sweeps entries outside the replay window.
fn check_and_record_replay(conn: &Connection, account_id: i64, step: i64) -> Result<(), Rejection> {
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
    conn.execute(
        "DELETE FROM totp_used WHERE step < ?1",
        [step - REPLAY_WINDOW_STEPS],
    )
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
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn hash_recovery_code(code: &str) -> String {
    to_hex(&Sha256::digest(normalize_recovery_code(code).as_bytes()))
}

/// Consumes one unused recovery code for this account, if `code` matches one.
/// Single-use: the matching row's `used_at` is stamped so it can never verify
/// again, recovery-code or otherwise.
fn verify_recovery_code(conn: &Connection, account_id: i64, code: &str) -> Result<(), Rejection> {
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
    conn.execute(
        "UPDATE recovery_codes SET used_at = ?1 WHERE id = ?2",
        params![now_ms(), id],
    )
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
    conn: &Connection,
    kek: Kek,
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
        lockout::check(conn, account_id, "totp")?;
        return match verify_recovery_code(conn, account_id, rc) {
            Ok(()) => {
                lockout::reset(conn, account_id, "totp")?;
                Ok(())
            }
            Err(e) => {
                lockout::record_failure(conn, account_id, "totp")?;
                Err(e)
            }
        };
    }

    let Some(code) = code.map(str::trim).filter(|c| !c.is_empty()) else {
        return Err((StatusCode::UNAUTHORIZED, CODE_REQUIRED.into()));
    };

    lockout::check(conn, account_id, "totp")?;
    let secret_b32 = decrypt_secret(kek, &secret_enc)?;
    let totp = totp_from_secret(&secret_b32)?;
    let Some(step) = matching_step(&totp, code) else {
        lockout::record_failure(conn, account_id, "totp")?;
        return Err((StatusCode::UNAUTHORIZED, CODE_WRONG.into()));
    };
    if let Err(e) = check_and_record_replay(conn, account_id, step) {
        lockout::record_failure(conn, account_id, "totp")?;
        return Err(e);
    }
    lockout::reset(conn, account_id, "totp")?;
    Ok(())
}

pub(crate) async fn totp_status(
    State(state): State<Arc<AppState>>,
    auth: Authed,
) -> Result<Json<Value>, Rejection> {
    state
        .db(move |conn| {
            let (enrolled, confirmed): (bool, bool) = conn
                .query_row(
                    "SELECT totp_secret IS NOT NULL, totp_confirmed != 0 FROM accounts WHERE id = ?1",
                    [auth.account_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(internal)?;
            Ok(Json(
                json!({ "enrolled": enrolled, "confirmed": confirmed }),
            ))
        })
        .await
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
    auth: Authed,
    Json(body): Json<EnrollReq>,
) -> Result<Json<Value>, Rejection> {
    let kek = state.kek;
    state
        .db(move |conn| {
            password::verify_account_password(conn, auth.account_id, &body.password)?;
            let (name, confirmed): (String, i64) = conn
                .query_row(
                    "SELECT name, totp_confirmed FROM accounts WHERE id = ?1",
                    [auth.account_id],
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
            let stored = encrypt_secret(kek, &secret_b32)?;
            conn.execute(
                "UPDATE accounts SET totp_secret = ?1 WHERE id = ?2",
                params![stored, auth.account_id],
            )
            .map_err(internal)?;
            Ok(Json(json!({ "secret": secret_b32, "uri": uri })))
        })
        .await
}

#[derive(Deserialize)]
pub(crate) struct ConfirmReq {
    code: String,
}

/// Confirms a pending enrollment with its first code and hands out the
/// recovery codes. One transaction: the flag and the codes appear together
/// or not at all, and an already-confirmed account is refused rather than
/// having its recovery codes silently regenerated by any session that can
/// produce a current code.
pub(crate) async fn enroll_confirm(
    State(state): State<Arc<AppState>>,
    auth: Authed,
    Json(body): Json<ConfirmReq>,
) -> Result<Json<Value>, Rejection> {
    let kek = state.kek;
    state
        .db(move |conn| {
            let row: Option<(Option<String>, i64)> = conn
                .query_row(
                    "SELECT totp_secret, totp_confirmed FROM accounts WHERE id = ?1",
                    [auth.account_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(internal)?;
            let Some((Some(secret_enc), confirmed)) = row else {
                return Err((
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Start enrollment before confirming a code.".into(),
                ));
            };
            if confirmed != 0 {
                return Err((
                    StatusCode::CONFLICT,
                    "Two-factor authentication is already turned on.".into(),
                ));
            }
            let secret_b32 = decrypt_secret(kek, &secret_enc)?;
            let totp = totp_from_secret(&secret_b32)?;
            let code = body.code.trim();
            let ok = totp.check_current(code).map_err(internal)?;
            if !ok {
                return Err((StatusCode::UNAUTHORIZED, CODE_WRONG.into()));
            }

            let tx = conn.transaction().map_err(internal)?;
            tx.execute(
                "UPDATE accounts SET totp_confirmed = 1 WHERE id = ?1",
                [auth.account_id],
            )
            .map_err(internal)?;
            // Fresh codes replace any left over from a previous enrollment.
            tx.execute(
                "DELETE FROM recovery_codes WHERE account_id = ?1",
                [auth.account_id],
            )
            .map_err(internal)?;
            let codes = generate_recovery_codes();
            let now = now_ms();
            for c in &codes {
                tx.execute(
                    "INSERT INTO recovery_codes (account_id, code_hash, created_at) VALUES (?1, ?2, ?3)",
                    params![auth.account_id, hash_recovery_code(c), now],
                )
                .map_err(internal)?;
            }
            tx.commit().map_err(internal)?;

            Ok(Json(json!({ "confirmed": true, "recoveryCodes": codes })))
        })
        .await
}

pub(crate) async fn disable_totp(
    State(state): State<Arc<AppState>>,
    auth: Authed,
) -> Result<Json<Value>, Rejection> {
    state
        .db(move |conn| {
            let tx = conn.transaction().map_err(internal)?;
            for sql in [
                "UPDATE accounts SET totp_secret = NULL, totp_confirmed = 0 WHERE id = ?1",
                "DELETE FROM recovery_codes WHERE account_id = ?1",
                "DELETE FROM totp_used WHERE account_id = ?1",
            ] {
                tx.execute(sql, [auth.account_id]).map_err(internal)?;
            }
            tx.commit().map_err(internal)?;
            Ok(Json(json!({ "disabled": true })))
        })
        .await
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::auth::{mint_token, token_hash};

    /// The fixed key every test encrypts under — a value on `AppState`, not an
    /// environment variable, so tests need no serialisation between them.
    pub(crate) const KEK: [u8; 32] = [7u8; 32];

    fn mem() -> Connection {
        crate::schema::test_db(None)
    }

    fn add_account(c: &Connection, name: &str) -> i64 {
        c.execute(
            "INSERT INTO accounts (name, created_at) VALUES (?1, 0)",
            [name],
        )
        .unwrap();
        c.last_insert_rowid()
    }

    fn store_secret(c: &Connection, id: i64, secret_b32: &str) {
        let stored = encrypt_secret(Some(KEK), secret_b32).unwrap();
        c.execute(
            "UPDATE accounts SET totp_secret = ?1 WHERE id = ?2",
            params![stored, id],
        )
        .unwrap();
    }

    /// Puts the account in the state a finished enrollment leaves it in,
    /// under `KEK` — what `password.rs`'s 428 test needs.
    pub(crate) fn enroll_confirmed(c: &Connection, id: i64, secret_b32: &str) {
        store_secret(c, id, secret_b32);
        c.execute("UPDATE accounts SET totp_confirmed = 1 WHERE id = ?1", [id])
            .unwrap();
    }

    /// Generates a code from the same secret+time totp-rs itself would use, so
    /// tests exercise real verification rather than a hardcoded digit string.
    pub(crate) fn code_for(secret_b32: &str) -> String {
        totp_from_secret(secret_b32)
            .unwrap()
            .generate_current()
            .unwrap()
    }

    /// Stores a fresh set of recovery codes for the account and returns them
    /// in the clear, as `enroll_confirm` would have.
    pub(crate) fn issue_recovery_codes(c: &Connection, id: i64) -> Vec<String> {
        let codes = generate_recovery_codes();
        for code in &codes {
            c.execute(
                "INSERT INTO recovery_codes (account_id, code_hash, created_at) VALUES (?1, ?2, 0)",
                params![id, hash_recovery_code(code)],
            )
            .unwrap();
        }
        codes
    }

    /// A secret long enough for `totp-rs` (it refuses anything under 128
    /// bits), base32-encoded as an authenticator would receive it.
    pub(crate) fn fresh_secret() -> String {
        match Secret::generate_secret().to_encoded() {
            Secret::Encoded(s) => s,
            _ => unreachable!(),
        }
    }

    #[test]
    fn encrypt_decrypt_round_trips_and_fails_closed_without_a_kek() {
        let enc = encrypt_secret(Some(KEK), "JBSWY3DPEHPK3PXP").unwrap();
        assert_ne!(
            enc, "JBSWY3DPEHPK3PXP",
            "must not store the secret in the clear"
        );
        assert_eq!(decrypt_secret(Some(KEK), &enc).unwrap(), "JBSWY3DPEHPK3PXP");

        assert_eq!(
            encrypt_secret(None, "JBSWY3DPEHPK3PXP").unwrap_err().0,
            StatusCode::SERVICE_UNAVAILABLE,
            "enrollment must refuse rather than store a plaintext secret"
        );
        assert_eq!(
            decrypt_secret(None, &enc).unwrap_err().0,
            StatusCode::SERVICE_UNAVAILABLE,
            "a secret that cannot be read must not read as 'not enrolled'"
        );
        assert!(
            decrypt_secret(Some([8u8; 32]), &enc).is_err(),
            "rotated key"
        );
    }

    #[test]
    fn recovery_codes_are_case_and_dash_insensitive_and_single_use() {
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
    }

    #[test]
    fn unenrolled_account_passes_through() {
        let c = mem();
        let id = add_account(&c, "sarah");
        assert!(verify_if_enrolled(&c, None, id, None, None).is_ok());
        assert!(verify_if_enrolled(&c, None, id, Some("000000"), None).is_ok());
    }

    #[test]
    fn unconfirmed_enrollment_does_not_gate_login() {
        let c = mem();
        let id = add_account(&c, "sarah");
        store_secret(&c, id, "JBSWY3DPEHPK3PXP");
        // totp_confirmed is still 0 — an abandoned enrollment must not lock
        // out password login.
        assert!(verify_if_enrolled(&c, Some(KEK), id, None, None).is_ok());
    }

    #[test]
    fn enroll_then_confirm_then_verify_accepts_a_generated_code_once() {
        let c = mem();
        let id = add_account(&c, "sarah");
        let secret_b32 = fresh_secret();
        store_secret(&c, id, &secret_b32);

        // Not confirmed yet: still passes through with no code.
        assert!(verify_if_enrolled(&c, Some(KEK), id, None, None).is_ok());
        c.execute("UPDATE accounts SET totp_confirmed = 1 WHERE id = ?1", [id])
            .unwrap();

        let code = code_for(&secret_b32);
        assert!(verify_if_enrolled(&c, Some(KEK), id, Some(&code), None).is_ok());

        // Replaying the exact same code within its own step must fail even
        // though the code is still numerically correct.
        let err = verify_if_enrolled(&c, Some(KEK), id, Some(&code), None).unwrap_err();
        assert_eq!(err.0, StatusCode::UNAUTHORIZED);
    }

    /// A code from the previous step is still valid (skew), but only once:
    /// the replay record must key on the step the code was minted for, not
    /// on whatever step the server happened to be in when it checked it.
    #[test]
    fn a_skewed_code_is_single_use_too() {
        let c = mem();
        let id = add_account(&c, "skew");
        let secret_b32 = fresh_secret();
        enroll_confirmed(&c, id, &secret_b32);
        let totp = totp_from_secret(&secret_b32).unwrap();

        // Mint for "one step ago", re-minting if the clock rolled over
        // between reading the step and generating.
        let previous = loop {
            let step = current_step() - 1;
            let code = totp.generate((step * STEP_SECONDS) as u64);
            if current_step() - 1 == step {
                break (step, code);
            }
        };
        assert!(verify_if_enrolled(&c, Some(KEK), id, Some(&previous.1), None).is_ok());
        let recorded: i64 = c
            .query_row(
                "SELECT step FROM totp_used WHERE account_id = ?1",
                [id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            recorded, previous.0,
            "replay record keys on the matched step"
        );

        let err = verify_if_enrolled(&c, Some(KEK), id, Some(&previous.1), None).unwrap_err();
        assert_eq!(err.0, StatusCode::UNAUTHORIZED);

        // The current step's code is a different code and still works.
        assert!(verify_if_enrolled(&c, Some(KEK), id, Some(&code_for(&secret_b32)), None).is_ok());
    }

    #[test]
    fn confirmed_totp_rejects_wrong_code_and_locks_out_after_ten() {
        let c = mem();
        let id = add_account(&c, "sarah");
        let secret_b32 = fresh_secret();
        enroll_confirmed(&c, id, &secret_b32);

        let real = code_for(&secret_b32);
        let mut wrong: Vec<char> = real.chars().collect();
        let d = wrong[0].to_digit(10).unwrap();
        wrong[0] = std::char::from_digit((d + 1) % 10, 10).unwrap();
        let wrong: String = wrong.into_iter().collect();
        assert_ne!(wrong, real);

        // Ten wrong attempts, each individually a plain 401 — the account
        // only becomes locked out *after* the 10th is recorded.
        for _ in 0..10 {
            let err = verify_if_enrolled(&c, Some(KEK), id, Some(&wrong), None).unwrap_err();
            assert_eq!(err.0, StatusCode::UNAUTHORIZED);
        }

        // The 11th attempt is refused as locked before the code is even
        // looked at — even the *correct* code is refused while locked out.
        let err = verify_if_enrolled(&c, Some(KEK), id, Some(&real), None).unwrap_err();
        assert_eq!(
            err.0,
            StatusCode::LOCKED,
            "11th attempt must see the lockout from the 10th failure"
        );
    }

    #[test]
    fn confirmed_totp_requires_a_code_or_recovery_code() {
        let c = mem();
        let id = add_account(&c, "sarah");
        enroll_confirmed(&c, id, &fresh_secret());

        let err = verify_if_enrolled(&c, Some(KEK), id, None, None).unwrap_err();
        assert_eq!(err.0, StatusCode::UNAUTHORIZED);
        assert_eq!(err.1, CODE_REQUIRED);

        let err = verify_if_enrolled(&c, Some(KEK), id, Some(""), None).unwrap_err();
        assert_eq!(err.1, CODE_REQUIRED);
    }

    fn again(auth: &Authed) -> Authed {
        Authed {
            account_id: auth.account_id,
            token_hash: auth.token_hash.clone(),
        }
    }

    /// End-to-end through the real handlers: enroll (with password
    /// re-verification), confirm with a code generated from the returned
    /// secret (receiving recovery codes), check `/totp`, sign in with one of
    /// those recovery codes in place of a TOTP code, and re-enroll.
    #[tokio::test]
    async fn enroll_confirm_recovery_and_reenroll_via_handlers() {
        let c = mem();
        let id = add_account(&c, "sarah");
        c.execute(
            "UPDATE accounts SET password_hash = ?1 WHERE id = ?2",
            params![password::hash_password("CorrectHorseBattery1").unwrap(), id],
        )
        .unwrap();
        let token = mint_token(&c, id, "device").unwrap();
        let auth = Authed {
            account_id: id,
            token_hash: token_hash(&token),
        };
        let state = Arc::new(AppState {
            kek: Some(KEK),
            ..AppState::for_test(c)
        });
        let enroll = |password: &str| {
            enroll_start(
                State(state.clone()),
                again(&auth),
                Json(EnrollReq {
                    password: password.into(),
                }),
            )
        };

        let status = totp_status(State(state.clone()), again(&auth))
            .await
            .unwrap()
            .0;
        assert_eq!(status["enrolled"], false);

        let wrong_password = enroll("not-it").await;
        assert_eq!(wrong_password.unwrap_err().0, StatusCode::UNAUTHORIZED);

        let enrolled = enroll("CorrectHorseBattery1").await.unwrap().0;
        let secret_b32 = enrolled["secret"].as_str().unwrap().to_string();
        let uri = enrolled["uri"].as_str().unwrap();
        assert!(uri.starts_with("otpauth://totp/"));
        assert!(uri.contains(&secret_b32));

        let status = totp_status(State(state.clone()), again(&auth))
            .await
            .unwrap()
            .0;
        assert_eq!(status["enrolled"], true);
        assert_eq!(status["confirmed"], false);

        let confirm = |code: String| {
            enroll_confirm(
                State(state.clone()),
                again(&auth),
                Json(ConfirmReq { code }),
            )
        };
        assert!(confirm("000000".into()).await.is_err());

        let confirmed = confirm(code_for(&secret_b32)).await.unwrap().0;
        assert_eq!(confirmed["confirmed"], true);
        let codes: Vec<String> = confirmed["recoveryCodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        assert_eq!(codes.len(), 8);

        // Confirming again must not mint a second set of recovery codes.
        let again_err = confirm(code_for(&secret_b32)).await.unwrap_err();
        assert_eq!(again_err.0, StatusCode::CONFLICT);

        // A recovery code stands in for a TOTP code at login.
        {
            let guard = state.conn.lock().unwrap();
            assert!(verify_if_enrolled(&guard, Some(KEK), id, None, Some(&codes[0])).is_ok());
            // Single-use.
            assert!(verify_if_enrolled(&guard, Some(KEK), id, None, Some(&codes[0])).is_err());
        }

        let err = enroll("CorrectHorseBattery1").await.unwrap_err();
        assert_eq!(err.0, StatusCode::CONFLICT);

        let _ = disable_totp(State(state.clone()), again(&auth))
            .await
            .unwrap();
        let status = totp_status(State(state.clone()), again(&auth))
            .await
            .unwrap()
            .0;
        assert_eq!(status["enrolled"], false);
        assert!(enroll("CorrectHorseBattery1").await.is_ok());
    }

    /// Without a KEK the server must refuse to enroll, not store plaintext.
    #[tokio::test]
    async fn enrollment_needs_a_kek() {
        let c = mem();
        let id = add_account(&c, "nokek");
        c.execute(
            "UPDATE accounts SET password_hash = ?1 WHERE id = ?2",
            params![password::hash_password("CorrectHorseBattery1").unwrap(), id],
        )
        .unwrap();
        let token = mint_token(&c, id, "device").unwrap();
        let state = Arc::new(AppState::for_test(c));
        let err = enroll_start(
            State(state),
            Authed {
                account_id: id,
                token_hash: token_hash(&token),
            },
            Json(EnrollReq {
                password: "CorrectHorseBattery1".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, StatusCode::SERVICE_UNAVAILABLE);
    }
}
