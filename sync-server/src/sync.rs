//! `POST /sync`: the pull-then-push transaction and the share filtering that
//! decides which of another account's rows ride along.

use axum::{extract::State, http::{HeaderMap, StatusCode}, Json};
use rusqlite::{params, Connection};
use std::sync::Arc;

use crate::{account_for, AppState, Change, SharedChange, SyncReq, SyncRes};

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
    headers: HeaderMap,
    Json(req): Json<SyncReq>,
) -> Result<Json<SyncRes>, StatusCode> {
    let mut guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let account_id = account_for(&guard, &headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let tx = guard
        .transaction()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let res = apply_sync(&tx, account_id, &req).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(res))
}

pub(crate) fn apply_sync(tx: &Connection, account_id: i64, req: &SyncReq) -> rusqlite::Result<SyncRes> {
    // Pull *before* applying the push, so the client never receives its own
    // writes back as an echo — they are assigned seqs below this snapshot.
    let changes = {
        let mut stmt = tx.prepare(
            "SELECT tbl, pk, payload, updated_at, deleted FROM rows
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
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    // Rows shared *with* this account. A grant-revision mismatch means grants
    // changed since the client's snapshot (rows may have been revoked), so it
    // rebuilds from zero — in which case tombstones are omitted, since the
    // client has nothing they could apply to.
    let my_rev: i64 =
        tx.query_row("SELECT grant_rev FROM accounts WHERE id = ?1", [account_id], |r| r.get(0))?;
    let effective_since = if req.grant_rev == my_rev { req.shared_since } else { 0 };
    let mut shared = Vec::new();
    {
        let mut grants = tx.prepare(
            "SELECT s.owner_id, a.name, s.calendar, s.todos
             FROM shares s JOIN accounts a ON a.id = s.owner_id
             WHERE s.grantee_id = ?1",
        )?;
        let grants = grants
            .query_map([account_id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)? != 0, r.get::<_, i64>(3)? != 0))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (owner_id, owner_name, calendar, todos) in grants {
            let tbls = granted_tables(calendar, todos);
            if tbls.is_empty() {
                continue;
            }
            let tbl_list = tbls.iter().map(|t| format!("'{t}'")).collect::<Vec<_>>().join(", ");
            let skip_tombstones = if effective_since == 0 { " AND deleted = 0" } else { "" };
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

    let watermark: i64 =
        tx.query_row("SELECT COALESCE(MAX(seq), 0) FROM rows", [], |r| r.get(0))?;
    // The shared snapshot was taken in this same transaction, so the one
    // watermark covers both streams: any later shared write gets a higher seq.
    Ok(SyncRes {
        seq: watermark,
        changes,
        shared,
        shared_seq: watermark,
        grant_rev: my_rev,
    })
}
