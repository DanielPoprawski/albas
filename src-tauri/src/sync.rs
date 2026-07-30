//! Two-way sync against a self-hosted `albas-sync` endpoint (see `sync-server/`).
//!
//! The schema was already built for this: every syncable table carries
//! `updated_at` and a `deleted` tombstone, and every write in `db.rs` stamps
//! them. So a sync is just:
//!
//!   1. collect rows whose `updated_at` is newer than our push watermark,
//!   2. POST them and receive everything the server has seen since our pull
//!      watermark,
//!   3. apply those with last-write-wins on `updated_at`.
//!
//! The server stores opaque `(table, pk) -> payload` rows and never parses the
//! app's data, so adding a column here needs no server change — only an entry
//! in `TABLES` below.
//!
//! Settings are deliberately *not* synced. On Android the Wyze credentials live
//! in `meta` under `setting:__wyze_credentials` (no keyring backend there), so
//! syncing settings wholesale would upload a plaintext password. Device-local
//! preferences like `theme` are also reasonable to keep per-device.

use crate::db::{self, Db};
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, ToSql};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Joins the parts of a composite primary key into the server's opaque `pk`.
/// U+0001 cannot occur in an id, ISO date, or any other key column we use.
const PK_SEP: char = '\u{1}';

const META_PULL_SEQ: &str = "sync_pull_seq";
const META_PUSH_AT: &str = "sync_push_at";
const META_LAST_AT: &str = "sync_last_at";

/// Settings keys holding the endpoint. Named with the `__` prefix to match
/// `__wyze_credentials`: secret-ish, and never synced.
const URL_SETTING: &str = "__sync_url";
const TOKEN_SETTING: &str = "__sync_token";

struct Spec {
    tbl: &'static str,
    pk: &'static [&'static str],
    cols: &'static [&'static str],
}

/// Mirrors the schema in `db.rs`. `updated_at`/`deleted` are handled separately
/// for every table and must not be listed in `cols`.
const TABLES: &[Spec] = &[
    Spec {
        tbl: "tasks",
        pk: &["id"],
        cols: &["title", "category", "completed", "date"],
    },
    Spec {
        tbl: "habits",
        pk: &["id"],
        cols: &[
            "name",
            "color_key",
            "kind",
            "unit",
            "target",
            "schedule",
            "created_at",
            "reminder",
            "due_date",
            "time",
            "category",
            "important",
        ],
    },
    Spec {
        tbl: "habit_completions",
        pk: &["habit_id", "date"],
        cols: &["value"],
    },
    Spec {
        tbl: "events",
        pk: &["id"],
        cols: &[
            "title",
            "description",
            "color_key",
            "all_day",
            "start_date",
            "start_time",
            "end_date",
            "end_time",
            "recurrence",
            "reminders",
        ],
    },
    Spec {
        tbl: "periods",
        pk: &["id"],
        cols: &["name", "color_key", "start_date", "end_date", "notes", "habit_ids"],
    },
    Spec {
        tbl: "weights",
        pk: &["id"],
        cols: &[
            "date",
            "ts",
            "weight_kg",
            "body_fat",
            "bmi",
            "muscle",
            "body_water",
            "source",
        ],
    },
];

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Change {
    tbl: String,
    pk: String,
    payload: serde_json::Value,
    updated_at: i64,
    deleted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncReq {
    since: i64,
    changes: Vec<Change>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncRes {
    seq: i64,
    changes: Vec<Change>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    pub pushed: usize,
    pub pulled: usize,
    /// Rows the server sent that this build could not apply — a column it does
    /// not know about. Surfaced rather than swallowed so a version mismatch
    /// between devices is visible instead of silently losing data.
    pub skipped: usize,
    pub last_sync: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub configured: bool,
    pub url: Option<String>,
    pub last_sync: Option<String>,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn val_to_json(v: ValueRef) -> serde_json::Value {
    match v {
        ValueRef::Null => serde_json::Value::Null,
        ValueRef::Integer(i) => serde_json::Value::from(i),
        ValueRef::Real(f) => serde_json::Value::from(f),
        ValueRef::Text(t) => serde_json::Value::String(String::from_utf8_lossy(t).into_owned()),
        // No BLOB columns exist in the schema; treat one as absent rather than panicking.
        ValueRef::Blob(_) => serde_json::Value::Null,
    }
}

fn json_to_sql(v: &serde_json::Value) -> SqlValue {
    match v {
        serde_json::Value::Null => SqlValue::Null,
        serde_json::Value::Bool(b) => SqlValue::Integer(*b as i64),
        serde_json::Value::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().unwrap_or(0.0)),
        },
        serde_json::Value::String(s) => SqlValue::Text(s.clone()),
        // JSON columns (schedule, recurrence, …) round-trip as TEXT, so this
        // only fires if a payload nests something unexpected.
        other => SqlValue::Text(other.to_string()),
    }
}

/// `https://` always; plain `http://` only against loopback, so the bearer
/// token can't leave the machine in cleartext by accident.
fn check_url(url: &str) -> Result<(), String> {
    if url.starts_with("https://") {
        return Ok(());
    }
    if let Some(rest) = url.strip_prefix("http://") {
        let host = rest.split(['/', ':']).next().unwrap_or("");
        if matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1") {
            return Ok(());
        }
        return Err(
            "Sync URL must use https:// — plain http:// is only allowed for localhost, \
             otherwise your sync token travels in cleartext."
                .into(),
        );
    }
    Err("Sync URL must start with https://".into())
}

fn collect(conn: &Connection, since: i64) -> rusqlite::Result<Vec<Change>> {
    let mut out = Vec::new();
    for spec in TABLES {
        let select = format!(
            "SELECT {}, {}, updated_at, deleted FROM {} WHERE updated_at > ?1",
            spec.pk.join(", "),
            spec.cols.join(", "),
            spec.tbl
        );
        let mut stmt = conn.prepare(&select)?;
        let n_pk = spec.pk.len();
        let n_col = spec.cols.len();
        let rows = stmt.query_map([since], |r| {
            let mut key = String::new();
            for i in 0..n_pk {
                if i > 0 {
                    key.push(PK_SEP);
                }
                key.push_str(&r.get::<_, String>(i)?);
            }
            let mut payload = serde_json::Map::new();
            for (i, col) in spec.cols.iter().enumerate() {
                payload.insert((*col).to_string(), val_to_json(r.get_ref(n_pk + i)?));
            }
            Ok(Change {
                tbl: spec.tbl.to_string(),
                pk: key,
                payload: serde_json::Value::Object(payload),
                updated_at: r.get(n_pk + n_col)?,
                deleted: r.get::<_, i64>(n_pk + n_col + 1)? != 0,
            })
        })?;
        for row in rows {
            out.push(row?);
        }
    }
    Ok(out)
}

/// Applies one incoming row. Returns false when the payload doesn't carry every
/// column this build expects, which means the row came from a newer schema.
fn apply_one(conn: &Connection, spec: &Spec, c: &Change) -> rusqlite::Result<bool> {
    let key_parts: Vec<&str> = c.pk.split(PK_SEP).collect();
    if key_parts.len() != spec.pk.len() {
        return Ok(false);
    }
    let Some(payload) = c.payload.as_object() else {
        return Ok(false);
    };
    if spec.cols.iter().any(|col| !payload.contains_key(*col)) {
        return Ok(false);
    }

    let all_cols: Vec<&str> = spec.pk.iter().chain(spec.cols.iter()).copied().collect();
    let placeholders: Vec<String> = (1..=all_cols.len() + 2).map(|i| format!("?{i}")).collect();
    let assignments: Vec<String> = spec
        .cols
        .iter()
        .map(|c| format!("{c} = excluded.{c}"))
        .collect();

    let sql = format!(
        "INSERT INTO {tbl} ({cols}, updated_at, deleted) VALUES ({ph})
         ON CONFLICT({pk}) DO UPDATE SET {sets}, updated_at = excluded.updated_at, deleted = excluded.deleted
         WHERE excluded.updated_at > {tbl}.updated_at",
        tbl = spec.tbl,
        cols = all_cols.join(", "),
        ph = placeholders.join(", "),
        pk = spec.pk.join(", "),
        sets = assignments.join(", "),
    );

    let mut values: Vec<SqlValue> = key_parts
        .iter()
        .map(|p| SqlValue::Text((*p).to_string()))
        .collect();
    for col in spec.cols {
        values.push(json_to_sql(&payload[*col]));
    }
    values.push(SqlValue::Integer(c.updated_at));
    values.push(SqlValue::Integer(c.deleted as i64));

    let params: Vec<&dyn ToSql> = values.iter().map(|v| v as &dyn ToSql).collect();
    conn.execute(&sql, params.as_slice())?;
    Ok(true)
}

fn post(url: &str, token: &str, req: &SyncReq) -> Result<SyncRes, String> {
    let resp = ureq::post(url)
        .set("Authorization", &format!("Bearer {token}"))
        .timeout(Duration::from_secs(30))
        .send_json(req);

    match resp {
        Ok(r) => r.into_json::<SyncRes>().map_err(|e| format!("Bad response from server: {e}")),
        Err(ureq::Error::Status(401, _)) => {
            Err("Server rejected the sync token (401).".into())
        }
        Err(ureq::Error::Status(code, _)) => Err(format!("Server returned HTTP {code}.")),
        Err(e) => Err(format!("Couldn't reach the sync server: {e}")),
    }
}

fn run(db: &Db) -> Result<SyncOutcome, String> {
    let (url, token, since, push_at) = {
        let conn = db.0.lock().map_err(err)?;
        let url = db::read_setting(&conn, URL_SETTING)
            .filter(|s| !s.trim().is_empty())
            .ok_or("No sync server configured.")?;
        let token = db::read_setting(&conn, TOKEN_SETTING)
            .filter(|s| !s.trim().is_empty())
            .ok_or("No sync token configured.")?;
        let since = db::read_meta(&conn, META_PULL_SEQ)
            .and_then(|v| v.parse().ok())
            .unwrap_or(0i64);
        let push_at = db::read_meta(&conn, META_PUSH_AT)
            .and_then(|v| v.parse().ok())
            .unwrap_or(0i64);
        (url.trim().to_string(), token.trim().to_string(), since, push_at)
    };
    check_url(&url)?;

    // Taken before collecting, so an edit made while the request is in flight
    // has updated_at > cutoff and is picked up by the next sync rather than lost.
    let cutoff = now_ms();
    let changes = {
        let conn = db.0.lock().map_err(err)?;
        collect(&conn, push_at).map_err(err)?
    };
    let pushed = changes.len();

    // The lock is released across the network call so the UI keeps working.
    let res = post(&url, &token, &SyncReq { since, changes })?;

    let mut applied = 0usize;
    let mut skipped = 0usize;
    let stamp = now_ms();
    {
        let mut guard = db.0.lock().map_err(err)?;
        let tx = guard.transaction().map_err(err)?;
        for c in &res.changes {
            match TABLES.iter().find(|s| s.tbl == c.tbl) {
                Some(spec) => {
                    if apply_one(&tx, spec, c).map_err(err)? {
                        applied += 1;
                    } else {
                        skipped += 1;
                    }
                }
                None => skipped += 1,
            }
        }
        db::write_meta(&tx, META_PULL_SEQ, &res.seq.to_string()).map_err(err)?;
        db::write_meta(&tx, META_PUSH_AT, &cutoff.to_string()).map_err(err)?;
        db::write_meta(&tx, META_LAST_AT, &stamp.to_string()).map_err(err)?;
        tx.commit().map_err(err)?;
    }

    Ok(SyncOutcome {
        pushed,
        pulled: applied,
        skipped,
        last_sync: Some(stamp.to_string()),
    })
}

#[tauri::command]
pub async fn sync_now(app: tauri::AppHandle) -> Result<SyncOutcome, String> {
    // ureq is blocking and the merge holds the DB lock, so keep both off the
    // async runtime's worker threads — same shape as `fetch_ics`.
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        run(&app.state::<Db>())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn sync_status(db: tauri::State<Db>) -> Result<SyncStatus, String> {
    let conn = db.0.lock().map_err(err)?;
    let url = db::read_setting(&conn, URL_SETTING).filter(|s| !s.trim().is_empty());
    let token = db::read_setting(&conn, TOKEN_SETTING).filter(|s| !s.trim().is_empty());
    Ok(SyncStatus {
        configured: url.is_some() && token.is_some(),
        url,
        last_sync: db::read_meta(&conn, META_LAST_AT),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Db {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(&crate::db::test_schema()).unwrap();
        Db(std::sync::Mutex::new(conn))
    }

    #[test]
    fn url_check_allows_https_and_loopback_only() {
        assert!(check_url("https://sync.example.com/sync").is_ok());
        assert!(check_url("http://localhost:8787/sync").is_ok());
        assert!(check_url("http://127.0.0.1:8787/sync").is_ok());
        assert!(check_url("http://192.168.1.10:8787/sync").is_err());
        assert!(check_url("ftp://example.com").is_err());
    }

    /// Every column named in TABLES must exist, or collect() fails at runtime
    /// on a real database rather than here.
    #[test]
    fn table_specs_match_the_schema() {
        let d = db();
        let conn = d.0.lock().unwrap();
        for spec in TABLES {
            let sql = format!(
                "SELECT {}, {}, updated_at, deleted FROM {} LIMIT 0",
                spec.pk.join(", "),
                spec.cols.join(", "),
                spec.tbl
            );
            conn.prepare(&sql)
                .unwrap_or_else(|e| panic!("{} spec does not match schema: {e}", spec.tbl));
        }
    }

    #[test]
    fn round_trips_a_row_through_collect_and_apply() {
        let source = db();
        {
            let conn = source.0.lock().unwrap();
            conn.execute(
                "INSERT INTO habits (id, name, color_key, kind, unit, target, schedule,
                     created_at, reminder, due_date, time, updated_at, deleted)
                 VALUES ('h1', 'Run', '#ff0000', 'check', '', 1.0, '{\"type\":\"daily\"}',
                     '2026-07-01', 1, NULL, '07:30', 500, 0)",
                [],
            )
            .unwrap();
        }
        let changes = {
            let conn = source.0.lock().unwrap();
            collect(&conn, 0).unwrap()
        };
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].tbl, "habits");
        assert_eq!(changes[0].pk, "h1");

        let target = db();
        let spec = TABLES.iter().find(|s| s.tbl == "habits").unwrap();
        {
            let conn = target.0.lock().unwrap();
            assert!(apply_one(&conn, spec, &changes[0]).unwrap());
            let (name, time, target_val): (String, Option<String>, f64) = conn
                .query_row("SELECT name, time, target FROM habits WHERE id = 'h1'", [], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?))
                })
                .unwrap();
            assert_eq!(name, "Run");
            assert_eq!(time.as_deref(), Some("07:30"));
            assert_eq!(target_val, 1.0);
        }
    }

    /// A composite-key table has to survive the join/split, or completions
    /// would collide across dates.
    #[test]
    fn composite_primary_key_round_trips() {
        let source = db();
        {
            let conn = source.0.lock().unwrap();
            conn.execute(
                "INSERT INTO habit_completions (habit_id, date, value, updated_at, deleted)
                 VALUES ('h1', '2026-07-20', 2.5, 400, 0)",
                [],
            )
            .unwrap();
        }
        let changes = {
            let conn = source.0.lock().unwrap();
            collect(&conn, 0).unwrap()
        };
        let c = changes.iter().find(|c| c.tbl == "habit_completions").unwrap();
        assert_eq!(c.pk, format!("h1{PK_SEP}2026-07-20"));

        let target = db();
        let spec = TABLES.iter().find(|s| s.tbl == "habit_completions").unwrap();
        let conn = target.0.lock().unwrap();
        assert!(apply_one(&conn, spec, c).unwrap());
        let v: f64 = conn
            .query_row(
                "SELECT value FROM habit_completions WHERE habit_id='h1' AND date='2026-07-20'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v, 2.5);
    }

    /// The whole point of the merge rule: an older remote edit must not win.
    #[test]
    fn stale_incoming_row_does_not_clobber_newer_local() {
        let d = db();
        let conn = d.0.lock().unwrap();
        conn.execute(
            "INSERT INTO events (id, title, description, color_key, all_day, start_date,
                 start_time, end_date, end_time, recurrence, reminders, updated_at, deleted)
             VALUES ('e1', 'Local wins', '', '#fff', 1, '2026-07-01', NULL, '2026-07-01',
                 NULL, '{}', '[]', 900, 0)",
            [],
        )
        .unwrap();

        let spec = TABLES.iter().find(|s| s.tbl == "events").unwrap();
        let stale = Change {
            tbl: "events".into(),
            pk: "e1".into(),
            payload: serde_json::json!({
                "title": "Remote loses", "description": "", "color_key": "#000",
                "all_day": 1, "start_date": "2026-07-01", "start_time": null,
                "end_date": "2026-07-01", "end_time": null,
                "recurrence": "{}", "reminders": "[]"
            }),
            updated_at: 800,
            deleted: false,
        };
        assert!(apply_one(&conn, spec, &stale).unwrap());
        let title: String = conn
            .query_row("SELECT title FROM events WHERE id='e1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "Local wins");

        let fresh = Change { updated_at: 1000, ..stale };
        assert!(apply_one(&conn, spec, &fresh).unwrap());
        let title: String = conn
            .query_row("SELECT title FROM events WHERE id='e1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "Remote loses");
    }

    /// A tombstone must propagate, not resurrect the row.
    #[test]
    fn deletion_propagates_as_a_tombstone() {
        let d = db();
        let conn = d.0.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, category, completed, date, updated_at, deleted)
             VALUES ('t1', 'Buy milk', 'General', 0, NULL, 100, 0)",
            [],
        )
        .unwrap();
        let spec = TABLES.iter().find(|s| s.tbl == "tasks").unwrap();
        let del = Change {
            tbl: "tasks".into(),
            pk: "t1".into(),
            payload: serde_json::json!({
                "title": "Buy milk", "category": "General", "completed": 0, "date": null
            }),
            updated_at: 200,
            deleted: true,
        };
        assert!(apply_one(&conn, spec, &del).unwrap());
        let deleted: i64 = conn
            .query_row("SELECT deleted FROM tasks WHERE id='t1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(deleted, 1);
    }

    /// End-to-end against a live `albas-sync`. Ignored by default because it
    /// needs a server; run it with:
    ///
    ///   ALBAS_SYNC_TEST_URL=http://127.0.0.1:8799/sync \
    ///   ALBAS_SYNC_TEST_TOKEN=… cargo test --lib -- --ignored --nocapture
    ///
    /// Point it at a *throwaway* database — it writes rows.
    #[test]
    #[ignore]
    fn two_devices_converge_through_a_live_server() {
        let (Ok(url), Ok(token)) = (
            std::env::var("ALBAS_SYNC_TEST_URL"),
            std::env::var("ALBAS_SYNC_TEST_TOKEN"),
        ) else {
            panic!("set ALBAS_SYNC_TEST_URL and ALBAS_SYNC_TEST_TOKEN");
        };
        let configure = |d: &Db| {
            let conn = d.0.lock().unwrap();
            db::write_setting(&conn, URL_SETTING, &url).unwrap();
            db::write_setting(&conn, TOKEN_SETTING, &token).unwrap();
        };

        let id = format!("e2e-{}", now_ms());
        let a = db();
        let b = db();
        configure(&a);
        configure(&b);

        // Device A creates a to-do and pushes it.
        {
            let conn = a.0.lock().unwrap();
            conn.execute(
                "INSERT INTO habits (id, name, color_key, kind, unit, target, schedule,
                     created_at, reminder, due_date, time, updated_at, deleted)
                 VALUES (?1, 'Stretch', '#0f0', 'check', '', 1.0, '{\"type\":\"daily\"}',
                     '2026-07-27', 0, NULL, NULL, ?2, 0)",
                rusqlite::params![id, now_ms()],
            )
            .unwrap();
        }
        let out = run(&a).expect("device A sync");
        assert!(out.pushed >= 1, "A should have pushed its new row");

        // Device B pulls it.
        let out = run(&b).expect("device B sync");
        assert!(out.pulled >= 1, "B should have received A's row");
        {
            let conn = b.0.lock().unwrap();
            let name: String = conn
                .query_row("SELECT name FROM habits WHERE id = ?1", [&id], |r| r.get(0))
                .expect("row should have landed on B");
            assert_eq!(name, "Stretch");
        }

        // B renames it and pushes; A picks the change up rather than keeping its own.
        {
            let conn = b.0.lock().unwrap();
            conn.execute(
                "UPDATE habits SET name = 'Stretch 10m', updated_at = ?2 WHERE id = ?1",
                rusqlite::params![id, now_ms() + 1],
            )
            .unwrap();
        }
        run(&b).expect("device B second sync");
        run(&a).expect("device A second sync");
        {
            let conn = a.0.lock().unwrap();
            let name: String = conn
                .query_row("SELECT name FROM habits WHERE id = ?1", [&id], |r| r.get(0))
                .unwrap();
            assert_eq!(name, "Stretch 10m", "A should have taken B's newer edit");
        }

        // A deletes it; the tombstone reaches B.
        {
            let conn = a.0.lock().unwrap();
            conn.execute(
                "UPDATE habits SET deleted = 1, updated_at = ?2 WHERE id = ?1",
                rusqlite::params![id, now_ms() + 2],
            )
            .unwrap();
        }
        run(&a).expect("device A third sync");
        run(&b).expect("device B third sync");
        {
            let conn = b.0.lock().unwrap();
            let deleted: i64 = conn
                .query_row("SELECT deleted FROM habits WHERE id = ?1", [&id], |r| r.get(0))
                .unwrap();
            assert_eq!(deleted, 1, "deletion should have propagated to B");
        }
    }

    /// A row from a build with an extra column is reported, not half-applied.
    #[test]
    fn payload_missing_a_column_is_skipped() {
        let d = db();
        let conn = d.0.lock().unwrap();
        let spec = TABLES.iter().find(|s| s.tbl == "tasks").unwrap();
        let partial = Change {
            tbl: "tasks".into(),
            pk: "t2".into(),
            payload: serde_json::json!({ "title": "No category key" }),
            updated_at: 300,
            deleted: false,
        };
        assert!(!apply_one(&conn, spec, &partial).unwrap());
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks WHERE id='t2'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }
}
