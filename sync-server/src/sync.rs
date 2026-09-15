//! `POST /sync`: the wire shapes, the pull-then-push transaction and the
//! share filtering that decides which of another account's rows ride along.

use axum::{extract::State, Json};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::auth::Authed;
use crate::error::{internal, Rejection};
use crate::AppState;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Change {
    pub(crate) tbl: String,
    pub(crate) pk: String,
    /// Every non-key, non-bookkeeping column, as a JSON object.
    pub(crate) payload: serde_json::Value,
    pub(crate) updated_at: i64,
    pub(crate) deleted: bool,
    /// Server sequence number, set on rows a pull returns so a client can
    /// resume just before one it could not apply. Ignored on a push (the
    /// server assigns it), and absent from older clients' requests.
    #[serde(default)]
    pub(crate) seq: i64,
}

/// A row belonging to another account that shared it with this one.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SharedChange {
    /// The sharing account's name.
    pub(crate) from: String,
    pub(crate) tbl: String,
    pub(crate) pk: String,
    pub(crate) payload: serde_json::Value,
    pub(crate) updated_at: i64,
    pub(crate) deleted: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncReq {
    /// Highest `seq` this client has already applied. 0 on first sync.
    pub(crate) since: i64,
    pub(crate) changes: Vec<Change>,
    /// Highest `seq` seen among *shared* rows. Defaults keep old clients working.
    #[serde(default)]
    pub(crate) shared_since: i64,
    /// The grant revision the client last saw; a mismatch means its shared
    /// cache may contain revoked rows, so it gets a full snapshot instead.
    #[serde(default)]
    pub(crate) grant_rev: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncRes {
    /// New watermark for the client to store and send as `since` next time.
    pub(crate) seq: i64,
    pub(crate) changes: Vec<Change>,
    pub(crate) shared: Vec<SharedChange>,
    pub(crate) shared_seq: i64,
    pub(crate) grant_rev: i64,
}

/// The tables a grant exposes. Todos and habits live in the same tables, hence
/// one combined group.
fn granted_tables(calendar: bool, todos: bool) -> Vec<&'static str> {
    let mut v = Vec::new();
    if calendar {
        v.extend(["events", "periods", "categories"]);
    }
    if todos {
        v.extend(["habits", "habit_completions", "tasks", "categories"]);
    }
    v
}

pub(crate) async fn sync(
    State(state): State<Arc<AppState>>,
    auth: Authed,
    Json(req): Json<SyncReq>,
) -> Result<Json<SyncRes>, Rejection> {
    state
        .db(move |conn| {
            let tx = conn.transaction().map_err(internal)?;
            let res = apply_sync(&tx, auth.account_id, &req).map_err(internal)?;
            tx.commit().map_err(internal)?;
            Ok(Json(res))
        })
        .await
}

pub(crate) fn apply_sync(
    tx: &Connection,
    account_id: i64,
    req: &SyncReq,
) -> rusqlite::Result<SyncRes> {
    // Pull *before* applying the push, so the client never receives its own
    // writes back as an echo — they are assigned seqs below this snapshot.
    let changes = {
        let mut stmt = tx.prepare(
            "SELECT tbl, pk, payload, updated_at, deleted, seq FROM rows
             WHERE account_id = ?1 AND seq > ?2 ORDER BY seq",
        )?;
        let rows = stmt.query_map(params![account_id, req.since], |r| {
            Ok(Change {
                tbl: r.get(0)?,
                pk: r.get(1)?,
                payload: serde_json::from_str(&r.get::<_, String>(2)?)
                    .unwrap_or(serde_json::Value::Null),
                updated_at: r.get(3)?,
                deleted: r.get::<_, i64>(4)? != 0,
                seq: r.get(5)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    // Rows shared *with* this account. A grant-revision mismatch means grants
    // changed since the client's snapshot (rows may have been revoked), so it
    // rebuilds from zero — in which case tombstones are omitted, since the
    // client has nothing they could apply to.
    let my_rev: i64 = tx.query_row(
        "SELECT grant_rev FROM accounts WHERE id = ?1",
        [account_id],
        |r| r.get(0),
    )?;
    let effective_since = if req.grant_rev == my_rev {
        req.shared_since
    } else {
        0
    };
    let mut shared = Vec::new();
    {
        let mut grants = tx.prepare(
            "SELECT s.owner_id, a.name, s.calendar, s.todos
             FROM shares s JOIN accounts a ON a.id = s.owner_id
             WHERE s.grantee_id = ?1",
        )?;
        let grants = grants
            .query_map([account_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)? != 0,
                    r.get::<_, i64>(3)? != 0,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (owner_id, owner_name, calendar, todos) in grants {
            let tbls = granted_tables(calendar, todos);
            if tbls.is_empty() {
                continue;
            }
            let tbl_list = tbls
                .iter()
                .map(|t| format!("'{t}'"))
                .collect::<Vec<_>>()
                .join(", ");
            let skip_tombstones = if effective_since == 0 {
                " AND deleted = 0"
            } else {
                ""
            };
            let sql = format!(
                "SELECT tbl, pk, payload, updated_at, deleted FROM rows
                 WHERE account_id = ?1 AND seq > ?2 AND tbl IN ({tbl_list}){skip_tombstones}
                 ORDER BY seq"
            );
            let mut stmt = tx.prepare(&sql)?;
            let rows = stmt.query_map(params![owner_id, effective_since], |r| {
                Ok(SharedChange {
                    from: owner_name.clone(),
                    tbl: r.get(0)?,
                    pk: r.get(1)?,
                    payload: serde_json::from_str(&r.get::<_, String>(2)?)
                        .unwrap_or(serde_json::Value::Null),
                    updated_at: r.get(3)?,
                    deleted: r.get::<_, i64>(4)? != 0,
                })
            })?;
            for row in rows {
                shared.push(row?);
            }
        }
    }

    // seq stays globally monotonic across accounts; pulls filter by account,
    // so gaps in one account's sequence are harmless.
    let mut seq: i64 = tx.query_row("SELECT COALESCE(MAX(seq), 0) FROM rows", [], |r| r.get(0))?;

    for c in &req.changes {
        seq += 1;
        // The WHERE on DO UPDATE is the last-write-wins rule: an edit older than
        // what we already hold is dropped, and the wasted seq is harmless.
        tx.execute(
            "INSERT INTO rows (account_id, tbl, pk, payload, updated_at, deleted, seq)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(account_id, tbl, pk) DO UPDATE SET
               payload = excluded.payload,
               updated_at = excluded.updated_at,
               deleted = excluded.deleted,
               seq = excluded.seq
             WHERE excluded.updated_at > rows.updated_at",
            params![
                account_id,
                c.tbl,
                c.pk,
                c.payload.to_string(),
                c.updated_at,
                c.deleted as i64,
                seq
            ],
        )?;
    }

    // The push's last seq is the watermark; a fresh MAX(seq) query would say
    // the same thing, since nothing else writes inside this transaction.
    Ok(SyncRes {
        seq,
        changes,
        shared,
        // The shared snapshot was taken in this same transaction, so the one
        // watermark covers both streams: any later shared write gets a higher seq.
        shared_seq: seq,
        grant_rev: my_rev,
    })
}
