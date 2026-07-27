//! Wyze scale sync.
//!
//! Wyze publishes no public API, so this is a port of the request shapes used
//! by the community `shauntarves/wyze-sdk` (which in turn mirrors the Android
//! app). Two calls are needed:
//!
//!   1. POST auth-prod.api.wyze.com/api/user/login  -> access_token
//!   2. GET  wyze-scale-service.wyzecam.com/plugin/scale/get_record_range
//!
//! The second is signed: `signature2` is an HMAC-MD5 of the request body
//! (for GET, the query params joined **sorted by key**) keyed by
//! md5(access_token + app salt). Both the sort order and the exact byte
//! encoding of the body are load-bearing — a mismatch reads as a 403.
//!
//! Running this in Rust rather than the WebView also sidesteps CORS, same
//! reason `fetch_ics` exists in lib.rs.

use hmac::{Hmac, Mac};
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::db::{self, Db};

const APP_ID: &str = "9319141212m2ik";
const SALT: &str = "wyze_app_secret_key_132";
const APP_INFO: &str = "wyze_android_2.19.14";
const AUTH_X_API_KEY: &str = "RckMFKbsds5p6QY3COEXc2ABwNTYY0q18ziEiSEm";
const AUTH_URL: &str = "https://auth-prod.api.wyze.com/api/user/login";
const RECORDS_URL: &str = "https://wyze-scale-service.wyzecam.com/plugin/scale/get_record_range";

const KEYRING_SERVICE: &str = "albas-wyze";
const KEYRING_USER: &str = "credentials";
/// Fallback storage key when no OS keyring is available (Android).
#[allow(dead_code)] // only read by the mobile `store` module
const CREDS_SETTING: &str = "__wyze_credentials";
const PHONE_ID_SETTING: &str = "__wyze_phone_id";
const LAST_SYNC_SETTING: &str = "wyzeLastSync";

type HmacMd5 = Hmac<Md5>;

#[derive(Serialize, Deserialize, Clone)]
pub struct Credentials {
    pub email: String,
    pub password: String,
    pub key_id: String,
    pub api_key: String,
}

/// Cached login. Wyze access tokens are long-lived; on a 4xx we just log in
/// again rather than implementing the separate refresh_token endpoint.
#[derive(Default)]
pub struct WyzeSession(pub Mutex<Option<String>>);

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn md5_hex(data: &[u8]) -> String {
    let mut h = Md5::new();
    h.update(data);
    format!("{:x}", h.finalize())
}

/// Wyze hashes the password three times before it ever leaves the device.
fn triple_md5(password: &str) -> String {
    md5_hex(md5_hex(md5_hex(password.as_bytes()).as_bytes()).as_bytes())
}

fn request_id(nonce: i64) -> String {
    md5_hex(md5_hex(nonce.to_string().as_bytes()).as_bytes())
}

/// HMAC-MD5(body) keyed by md5(access_token + salt).
fn dynamic_signature(access_token: &str, body: &str) -> String {
    let key = md5_hex(format!("{access_token}{SALT}").as_bytes());
    let mut mac = HmacMd5::new_from_slice(key.as_bytes()).expect("HMAC accepts any key length");
    mac.update(body.as_bytes());
    format!("{:x}", mac.finalize().into_bytes())
}

/// A stable per-install device id. Regenerating it every launch would change a
/// signed header, so it is persisted on first use.
fn phone_id(db: &Db) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = db::read_setting(&conn, PHONE_ID_SETTING) {
        return Ok(existing);
    }
    let fresh = uuid::Uuid::new_v4().to_string();
    db::write_setting(&conn, PHONE_ID_SETTING, &fresh).map_err(|e| e.to_string())?;
    Ok(fresh)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Expected values produced by the Python reference implementation
    /// (wyze_sdk.signature.RequestVerifier). If Wyze starts rejecting requests,
    /// confirm these still hold before suspecting the network code.
    #[test]
    fn signing_matches_reference() {
        assert_eq!(triple_md5("hunter2"), "7f5f74be86aa53a4abffeeeb0a3c2750");
        assert_eq!(
            dynamic_signature("tok", "a=1&b=2"),
            "a2e2e579eacb2e7befcf7d2767d67f72"
        );
        assert_eq!(
            dynamic_signature("", "{}"),
            "584613481298539a13ce802211d050f5"
        );
        assert_eq!(
            request_id(1_700_000_000_000),
            "474ecf29d67d8a9adc6d1e24393fc616"
        );
    }

    #[test]
    fn local_date_converts_epoch_ms() {
        // 2023-11-14T22:13:20Z
        assert_eq!(local_date(1_700_000_000_000), "2023-11-14");
        assert_eq!(local_date(0), "1970-01-01");
        // leap day
        assert_eq!(local_date(1_709_164_800_000), "2024-02-29");
    }
}

// ---------------------------------------------------------------------------
// Credential storage
// ---------------------------------------------------------------------------

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod store {
    use super::{Credentials, KEYRING_SERVICE, KEYRING_USER};

    pub fn save(_db: &super::Db, creds: &Credentials) -> Result<(), String> {
        let json = serde_json::to_string(creds).map_err(|e| e.to_string())?;
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .map_err(|e| e.to_string())?
            .set_password(&json)
            .map_err(|e| e.to_string())
    }

    pub fn load(_db: &super::Db) -> Option<Credentials> {
        let json = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .ok()?
            .get_password()
            .ok()?;
        serde_json::from_str(&json).ok()
    }

    pub fn clear(_db: &super::Db) -> Result<(), String> {
        match keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
            Ok(entry) => match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(e.to_string()),
            },
            Err(e) => Err(e.to_string()),
        }
    }
}

/// Android has no keyring backend, so credentials live in the SQLite file.
/// That file sits in app-private storage, which the OS sandboxes per app, but
/// it is *not* encrypted at rest.
#[cfg(any(target_os = "android", target_os = "ios"))]
mod store {
    use super::{Credentials, Db, CREDS_SETTING};
    use crate::db;

    pub fn save(dbs: &Db, creds: &Credentials) -> Result<(), String> {
        let json = serde_json::to_string(creds).map_err(|e| e.to_string())?;
        let conn = dbs.0.lock().map_err(|e| e.to_string())?;
        db::write_setting(&conn, CREDS_SETTING, &json).map_err(|e| e.to_string())
    }

    pub fn load(dbs: &Db) -> Option<Credentials> {
        let conn = dbs.0.lock().ok()?;
        serde_json::from_str(&db::read_setting(&conn, CREDS_SETTING)?).ok()
    }

    pub fn clear(dbs: &Db) -> Result<(), String> {
        let conn = dbs.0.lock().map_err(|e| e.to_string())?;
        db::write_setting(&conn, CREDS_SETTING, "").map_err(|e| e.to_string())
    }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

fn login(creds: &Credentials, phone_id: &str) -> Result<String, String> {
    let nonce = now_ms();
    let body = serde_json::json!({
        "nonce": nonce.to_string(),
        "email": creds.email,
        "password": triple_md5(&creds.password),
    });
    // Compact, no spaces — serde_json's default, and what the signature covers.
    let payload = serde_json::to_string(&body).map_err(|e| e.to_string())?;

    let resp = ureq::post(AUTH_URL)
        .set("x-api-key", AUTH_X_API_KEY)
        .set("keyid", &creds.key_id)
        .set("apikey", &creds.api_key)
        .set("appid", APP_ID)
        .set("appinfo", APP_INFO)
        .set("phoneid", phone_id)
        .set("requestid", &request_id(nonce))
        .set("signature2", &dynamic_signature("", &payload))
        .set("User-Agent", APP_INFO)
        .set("Content-Type", "application/json;charset=utf-8")
        .timeout(Duration::from_secs(30))
        .send_string(&payload)
        .map_err(describe)?;

    let json: serde_json::Value =
        serde_json::from_str(&resp.into_string().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;

    if let Some(token) = json.get("access_token").and_then(|v| v.as_str()) {
        if !token.is_empty() {
            return Ok(token.to_string());
        }
    }
    // An empty token with mfa_options set means the API key wasn't accepted as
    // the second factor — worth saying plainly, it's the common failure.
    if json.get("mfa_options").is_some() {
        return Err("Wyze wants a 2FA code. Check the API Key and Key ID are correct \
                    and belong to this account."
            .into());
    }
    Err(format!(
        "Wyze login failed: {}",
        json.get("description")
            .or_else(|| json.get("errorCode"))
            .map(|v| v.to_string())
            .unwrap_or_else(|| json.to_string())
    ))
}

/// Wyze's `data` array, with the fields the scale actually populates.
#[derive(Deserialize)]
struct RawRecord {
    data_id: Option<serde_json::Value>,
    measure_ts: Option<i64>,
    weight: Option<f64>,
    body_fat: Option<f64>,
    bmi: Option<f64>,
    muscle: Option<f64>,
    body_water: Option<f64>,
}

fn fetch_records(token: &str, phone_id: &str, start_ms: i64, end_ms: i64) -> Result<Vec<RawRecord>, String> {
    let nonce = now_ms();
    // Sorted by key: end_time, nonce, start_time. The signature is computed over
    // exactly this string, so the order must not change.
    let params = format!("end_time={end_ms}&nonce={nonce}&start_time={start_ms}");

    let resp = ureq::get(RECORDS_URL)
        .query("end_time", &end_ms.to_string())
        .query("nonce", &nonce.to_string())
        .query("start_time", &start_ms.to_string())
        .set("access_token", token)
        .set("appid", APP_ID)
        .set("appinfo", APP_INFO)
        .set("phoneid", phone_id)
        .set("requestid", &request_id(nonce))
        .set("signature2", &dynamic_signature(token, &params))
        .set("User-Agent", APP_INFO)
        .timeout(Duration::from_secs(30))
        .call()
        .map_err(describe)?;

    let json: serde_json::Value =
        serde_json::from_str(&resp.into_string().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let data = json.get("data").ok_or_else(|| {
        format!(
            "Unexpected Wyze response: {}",
            json.get("msg").map(|v| v.to_string()).unwrap_or_else(|| json.to_string())
        )
    })?;

    // The endpoint returns either a bare array or {data: {record_list: [...]}}
    // depending on scale model.
    let list = data
        .as_array()
        .or_else(|| data.get("record_list").and_then(|v| v.as_array()))
        .ok_or("Wyze returned no record list")?;

    Ok(list
        .iter()
        .filter_map(|v| serde_json::from_value::<RawRecord>(v.clone()).ok())
        .collect())
}

/// ureq folds HTTP error statuses into Transport/Status; surface the body,
/// which is where Wyze puts the actual reason.
fn describe(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            format!("Wyze returned HTTP {code}: {}", body.chars().take(300).collect::<String>())
        }
        other => other.to_string(),
    }
}

/// epoch ms -> local YYYY-MM-DD, so a reading lands on the day it was taken.
fn local_date(ts_ms: i64) -> String {
    let secs = ts_ms / 1000;
    let days = secs.div_euclid(86_400);
    // Civil-from-days (Howard Hinnant's algorithm), shifted to a March-based year.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WyzeStatus {
    pub connected: bool,
    pub email: Option<String>,
    pub last_sync: Option<String>,
}

#[tauri::command]
pub fn wyze_save_credentials(
    db: tauri::State<Db>,
    session: tauri::State<WyzeSession>,
    email: String,
    password: String,
    key_id: String,
    api_key: String,
) -> Result<(), String> {
    let creds = Credentials { email, password, key_id, api_key };
    store::save(&db, &creds)?;
    *session.0.lock().map_err(|e| e.to_string())? = None; // force a fresh login
    Ok(())
}

#[tauri::command]
pub fn wyze_clear_credentials(
    db: tauri::State<Db>,
    session: tauri::State<WyzeSession>,
) -> Result<(), String> {
    store::clear(&db)?;
    *session.0.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[tauri::command]
pub fn wyze_status(db: tauri::State<Db>) -> Result<WyzeStatus, String> {
    let creds = store::load(&db);
    let last_sync = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        db::read_setting(&conn, LAST_SYNC_SETTING)
    };
    Ok(WyzeStatus {
        connected: creds.is_some(),
        email: creds.map(|c| c.email),
        last_sync,
    })
}

/// Fetch the last `days` of readings and upsert them. Returns how many rows
/// landed. Re-syncing the same range is idempotent: Wyze's `data_id` is used
/// as the row id.
#[tauri::command]
pub async fn wyze_sync(
    app: tauri::AppHandle,
    days: i64,
) -> Result<usize, String> {
    use tauri::Manager;

    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        let session = app.state::<WyzeSession>();

        let creds = store::load(&db).ok_or("No Wyze credentials saved.")?;
        let phone = phone_id(&db)?;

        let end_ms = now_ms();
        let start_ms = end_ms - days.max(1) * 86_400_000;

        let cached = session.0.lock().map_err(|e| e.to_string())?.clone();
        let (records, token) = match cached {
            Some(token) => match fetch_records(&token, &phone, start_ms, end_ms) {
                Ok(r) => (r, token),
                // Token expired or rejected — log in once more before giving up.
                Err(_) => {
                    let fresh = login(&creds, &phone)?;
                    let r = fetch_records(&fresh, &phone, start_ms, end_ms)?;
                    (r, fresh)
                }
            },
            None => {
                let fresh = login(&creds, &phone)?;
                let r = fetch_records(&fresh, &phone, start_ms, end_ms)?;
                (r, fresh)
            }
        };
        *session.0.lock().map_err(|e| e.to_string())? = Some(token);

        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut saved = 0usize;
        for r in &records {
            let (Some(ts), Some(weight)) = (r.measure_ts, r.weight) else { continue };
            let id = match &r.data_id {
                Some(serde_json::Value::String(s)) => s.clone(),
                Some(v) => v.to_string(),
                // No upstream id: fall back to the timestamp, which is still
                // stable enough to keep re-syncs idempotent.
                None => format!("wyze-{ts}"),
            };
            let row = db::Weight {
                id: format!("wyze:{id}"),
                date: local_date(ts),
                ts,
                weight_kg: weight,
                body_fat: r.body_fat,
                bmi: r.bmi,
                muscle: r.muscle,
                body_water: r.body_water,
                source: "wyze".into(),
            };
            db::upsert_weight(&conn, &row).map_err(|e| e.to_string())?;
            saved += 1;
        }
        db::write_setting(&conn, LAST_SYNC_SETTING, &now_ms().to_string())
            .map_err(|e| e.to_string())?;

        Ok(saved)
    })
    .await
    .map_err(|e| e.to_string())?
}
