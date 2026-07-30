//! Albas sync endpoint.
//!
//! Deliberately knows nothing about todos, events or weights: it is a generic
//! `(table, pk) -> payload` store. Every row carries the client's `updated_at`
//! (for last-write-wins) and a server-assigned `seq` (for the pull watermark).
//! Adding a column to the app schema therefore needs no change here.
//!
//! Why two clocks: `updated_at` comes from whichever device made the edit, so
//! it is only as good as that device's clock — fine for deciding which of two
//! edits wins. `seq` is assigned here, strictly increasing, and is what clients
//! resume from, so a wrong device clock can never make a client skip a row.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS rows (
  tbl        TEXT    NOT NULL,
  pk         TEXT    NOT NULL,
  payload    TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  seq        INTEGER NOT NULL,
  PRIMARY KEY (tbl, pk)
);
CREATE INDEX IF NOT EXISTS rows_seq ON rows(seq);
";

struct AppState {
    conn: Mutex<Connection>,
    token: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Change {
    tbl: String,
    pk: String,
    /// Every non-key, non-bookkeeping column, as a JSON object.
    payload: serde_json::Value,
    updated_at: i64,
    deleted: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncReq {
    /// Highest `seq` this client has already applied. 0 on first sync.
    since: i64,
    changes: Vec<Change>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncRes {
    /// New watermark for the client to store and send as `since` next time.
    seq: i64,
    changes: Vec<Change>,
}

#[tokio::main]
async fn main() {
    let token = std::env::var("ALBAS_SYNC_TOKEN")
        .expect("ALBAS_SYNC_TOKEN must be set — clients authenticate with it");
    if token.len() < 16 {
        panic!("ALBAS_SYNC_TOKEN is too short; use at least 16 characters");
    }
    let db_path = std::env::var("ALBAS_SYNC_DB").unwrap_or_else(|_| "/data/albas-sync.db".into());
    let addr = std::env::var("ALBAS_SYNC_ADDR").unwrap_or_else(|_| "0.0.0.0:8787".into());

    let conn = Connection::open(&db_path).expect("failed to open database");
    conn.pragma_update(None, "journal_mode", "WAL").expect("WAL");
    conn.execute_batch(SCHEMA).expect("failed to create schema");

    let state = Arc::new(AppState { conn: Mutex::new(conn), token });

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/sync", post(sync))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind");
    println!("albas-sync listening on {addr}, db at {db_path}");
    axum::serve(listener, app).await.expect("serve");
}

/// Length-checked, non-short-circuiting compare so a wrong token doesn't leak
/// its correct prefix through response timing.
fn token_ok(expected: &str, got: &str) -> bool {
    if expected.len() != got.len() {
        return false;
    }
    expected
        .bytes()
        .zip(got.bytes())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

fn authorized(headers: &HeaderMap, expected: &str) -> bool {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|t| token_ok(expected, t))
}

async fn sync(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<SyncReq>,
) -> Result<Json<SyncRes>, StatusCode> {
    if !authorized(&headers, &state.token) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let mut guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tx = guard
        .transaction()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Pull *before* applying the push, so the client never receives its own
    // writes back as an echo — they are assigned seqs below this snapshot.
    let changes = {
        let mut stmt = tx
            .prepare("SELECT tbl, pk, payload, updated_at, deleted FROM rows WHERE seq > ?1 ORDER BY seq")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let rows = stmt
            .query_map(params![req.since], |r| {
                Ok(Change {
                    tbl: r.get(0)?,
                    pk: r.get(1)?,
                    payload: serde_json::from_str(&r.get::<_, String>(2)?)
                        .unwrap_or(serde_json::Value::Null),
                    updated_at: r.get(3)?,
                    deleted: r.get::<_, i64>(4)? != 0,
                })
            })
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    };

    let mut seq: i64 = tx
        .query_row("SELECT COALESCE(MAX(seq), 0) FROM rows", [], |r| r.get(0))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    for c in &req.changes {
        seq += 1;
        // The WHERE on DO UPDATE is the last-write-wins rule: an edit older than
        // what we already hold is dropped, and the wasted seq is harmless.
        tx.execute(
            "INSERT INTO rows (tbl, pk, payload, updated_at, deleted, seq)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(tbl, pk) DO UPDATE SET
               payload = excluded.payload,
               updated_at = excluded.updated_at,
               deleted = excluded.deleted,
               seq = excluded.seq
             WHERE excluded.updated_at > rows.updated_at",
            params![
                c.tbl,
                c.pk,
                c.payload.to_string(),
                c.updated_at,
                c.deleted as i64,
                seq
            ],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    let watermark: i64 = tx
        .query_row("SELECT COALESCE(MAX(seq), 0) FROM rows", [], |r| r.get(0))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(SyncRes { seq: watermark, changes }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_compare_rejects_prefixes_and_wrong_lengths() {
        assert!(token_ok("supersecrettoken", "supersecrettoken"));
        assert!(!token_ok("supersecrettoken", "supersecrettoke"));
        assert!(!token_ok("supersecrettoken", "supersecrettokenx"));
        assert!(!token_ok("supersecrettoken", "Supersecrettoken"));
    }

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(SCHEMA).unwrap();
        c
    }

    /// The core merge rule: a stale edit must not clobber a newer one, in
    /// either arrival order.
    #[test]
    fn last_write_wins_regardless_of_arrival_order() {
        let c = mem();
        let ins = "INSERT INTO rows (tbl, pk, payload, updated_at, deleted, seq)
             VALUES (?1, ?2, ?3, ?4, 0, ?5)
             ON CONFLICT(tbl, pk) DO UPDATE SET
               payload = excluded.payload, updated_at = excluded.updated_at,
               deleted = excluded.deleted, seq = excluded.seq
             WHERE excluded.updated_at > rows.updated_at";

        c.execute(ins, params!["habits", "a", "{\"name\":\"new\"}", 200, 1]).unwrap();
        c.execute(ins, params!["habits", "a", "{\"name\":\"old\"}", 100, 2]).unwrap();
        let got: String = c
            .query_row("SELECT payload FROM rows WHERE pk = 'a'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(got, "{\"name\":\"new\"}", "older edit must not overwrite newer");

        c.execute(ins, params!["habits", "b", "{\"name\":\"old\"}", 100, 3]).unwrap();
        c.execute(ins, params!["habits", "b", "{\"name\":\"new\"}", 200, 4]).unwrap();
        let got: String = c
            .query_row("SELECT payload FROM rows WHERE pk = 'b'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(got, "{\"name\":\"new\"}", "newer edit must overwrite older");
    }

    /// A rejected write must not advance the row's seq, or clients would pull
    /// a row whose contents did not change.
    #[test]
    fn rejected_write_leaves_seq_alone() {
        let c = mem();
        let ins = "INSERT INTO rows (tbl, pk, payload, updated_at, deleted, seq)
             VALUES (?1, ?2, ?3, ?4, 0, ?5)
             ON CONFLICT(tbl, pk) DO UPDATE SET
               payload = excluded.payload, updated_at = excluded.updated_at,
               deleted = excluded.deleted, seq = excluded.seq
             WHERE excluded.updated_at > rows.updated_at";
        c.execute(ins, params!["events", "e", "{}", 500, 7]).unwrap();
        c.execute(ins, params!["events", "e", "{}", 400, 8]).unwrap();
        let seq: i64 = c
            .query_row("SELECT seq FROM rows WHERE pk = 'e'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(seq, 7);
    }
}
