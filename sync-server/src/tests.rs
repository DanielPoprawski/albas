use super::*;
use crate::schema::table_columns;
use crate::sync::apply_sync;

fn mem(owner_token: Option<&str>) -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    init_db(&mut c, owner_token).unwrap();
    c
}

fn make_account(c: &Connection, name: &str) -> i64 {
    c.execute(
        "INSERT INTO accounts (name, created_at) VALUES (?1, 0)",
        params![name],
    )
    .unwrap();
    c.last_insert_rowid()
}

fn auth_headers(token: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert("authorization", format!("Bearer {token}").parse().unwrap());
    headers
}

fn change(tbl: &str, pk: &str, payload: &str, updated_at: i64) -> Change {
    Change {
        tbl: tbl.into(),
        pk: pk.into(),
        payload: serde_json::from_str(payload).unwrap(),
        updated_at,
        deleted: false,
        seq: 0,
    }
}

fn req(changes: Vec<Change>) -> SyncReq {
    SyncReq {
        since: 0,
        changes,
        shared_since: 0,
        grant_rev: 0,
    }
}

fn grant(c: &Connection, owner: i64, grantee: i64, calendar: bool, todos: bool) {
    c.execute(
        "INSERT INTO shares (owner_id, grantee_id, calendar, todos) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(owner_id, grantee_id) DO UPDATE SET
           calendar = excluded.calendar, todos = excluded.todos",
        params![owner, grantee, calendar as i64, todos as i64],
    )
    .unwrap();
    c.execute(
        "UPDATE accounts SET grant_rev = grant_rev + 1 WHERE id = ?1",
        [grantee],
    )
    .unwrap();
}

fn make_passkey(c: &Connection, account: i64, cred: &str) -> i64 {
    c.execute(
        "INSERT INTO passkeys (account_id, cred_id, passkey_json, created_at)
         VALUES (?1, ?2, '{}', 0)",
        params![account, cred],
    )
    .unwrap();
    c.last_insert_rowid()
}

fn grant_rev(c: &Connection, id: i64) -> i64 {
    c.query_row("SELECT grant_rev FROM accounts WHERE id = ?1", [id], |r| {
        r.get(0)
    })
    .unwrap()
}

#[test]
fn rename_validates_and_bumps_grantees() {
    let c = mem(None);
    let alice = make_account(&c, "alice");
    let bob = make_account(&c, "bob");
    make_account(&c, "carol");
    grant(&c, alice, bob, true, false);
    let rev = grant_rev(&c, bob);

    assert!(matches!(
        rename_account_db(&c, "alice", "bad name!"),
        Err(AdminError::Invalid(_))
    ));
    assert!(matches!(
        rename_account_db(&c, "missing", "fine"),
        Err(AdminError::NotFound)
    ));
    assert!(matches!(
        rename_account_db(&c, "alice", "carol"),
        Err(AdminError::Conflict(_))
    ));
    assert!(matches!(
        rename_account_db(&c, "owner", "boss"),
        Err(AdminError::Conflict(_))
    ));
    assert!(matches!(
        rename_account_db(&c, "alice", OWNER),
        Err(AdminError::Conflict(_))
    ));
    assert_eq!(
        grant_rev(&c, bob),
        rev,
        "failed renames must not bump grantees"
    );

    rename_account_db(&c, "alice", "alicia").unwrap();
    let name: String = c
        .query_row("SELECT name FROM accounts WHERE id = ?1", [alice], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(name, "alicia");
    // Bob caches alice's shared rows under her old name; his snapshot must
    // be invalidated exactly as a revocation would.
    assert_eq!(grant_rev(&c, bob), rev + 1);
}

#[test]
fn deleting_last_passkey_needs_another_login_method() {
    let c = mem(None);
    let a = make_account(&c, "a");
    let only = make_passkey(&c, a, "cred1");

    assert!(matches!(
        delete_passkey_db(&c, "missing", only),
        Err(AdminError::NotFound)
    ));
    assert!(matches!(
        delete_passkey_db(&c, "a", 999),
        Err(AdminError::NotFound)
    ));
    assert!(matches!(
        delete_passkey_db(&c, "a", only),
        Err(AdminError::Conflict(_))
    ));

    let second = make_passkey(&c, a, "cred2");
    assert!(
        delete_passkey_db(&c, "a", second).is_ok(),
        "not the last one"
    );
    assert!(matches!(
        delete_passkey_db(&c, "a", only),
        Err(AdminError::Conflict(_))
    ));

    c.execute("UPDATE accounts SET password_hash = 'x' WHERE id = ?1", [a])
        .unwrap();
    assert!(
        delete_passkey_db(&c, "a", only).is_ok(),
        "password remains as a way in"
    );

    let b = make_account(&c, "b");
    let bs = make_passkey(&c, b, "cred3");
    c.execute(
        "UPDATE accounts SET google_email = 'b@example.com' WHERE id = ?1",
        [b],
    )
    .unwrap();
    assert!(
        delete_passkey_db(&c, "b", bs).is_ok(),
        "google link counts too"
    );
}

#[test]
fn passkey_delete_is_scoped_to_the_named_account() {
    let c = mem(None);
    let a = make_account(&c, "a");
    make_account(&c, "b");
    make_passkey(&c, a, "cred1");
    let target = make_passkey(&c, a, "cred2");
    assert!(matches!(
        delete_passkey_db(&c, "b", target),
        Err(AdminError::NotFound)
    ));
    let still: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM passkeys WHERE id = ?1",
            [target],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(still, 1);
}

#[test]
fn clear_password_needs_another_login_method() {
    let c = mem(None);
    let a = make_account(&c, "a");

    assert!(matches!(
        clear_password_db(&c, "missing"),
        Err(AdminError::NotFound)
    ));
    assert!(
        clear_password_db(&c, "a").is_ok(),
        "no password set: idempotent no-op"
    );

    c.execute("UPDATE accounts SET password_hash = 'x' WHERE id = ?1", [a])
        .unwrap();
    assert!(
        matches!(clear_password_db(&c, "a"), Err(AdminError::Conflict(_))),
        "only credential"
    );

    make_passkey(&c, a, "cred1");
    clear_password_db(&c, "a").unwrap();
    let has: bool = c
        .query_row(
            "SELECT password_hash IS NOT NULL FROM accounts WHERE id = ?1",
            [a],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!has);
}

/// The core merge rule: a stale edit must not clobber a newer one, in
/// either arrival order.
#[test]
fn last_write_wins_regardless_of_arrival_order() {
    let mut c = mem(None);
    let acct = make_account(&c, "a");
    let tx = c.transaction().unwrap();

    let push = |r: &SyncReq| apply_sync(&tx, acct, r).unwrap();
    push(&req(vec![change("habits", "a", "{\"name\":\"new\"}", 200)]));
    push(&req(vec![change("habits", "a", "{\"name\":\"old\"}", 100)]));
    let got: String = tx
        .query_row("SELECT payload FROM rows WHERE pk = 'a'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        got, "{\"name\":\"new\"}",
        "older edit must not overwrite newer"
    );

    push(&req(vec![change("habits", "b", "{\"name\":\"old\"}", 100)]));
    push(&req(vec![change("habits", "b", "{\"name\":\"new\"}", 200)]));
    let got: String = tx
        .query_row("SELECT payload FROM rows WHERE pk = 'b'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(got, "{\"name\":\"new\"}", "newer edit must overwrite older");
}

/// A rejected write must not advance the row's seq, or clients would pull
/// a row whose contents did not change.
#[test]
fn rejected_write_leaves_seq_alone() {
    let mut c = mem(None);
    let acct = make_account(&c, "a");
    let tx = c.transaction().unwrap();
    apply_sync(&tx, acct, &req(vec![change("events", "e", "{}", 500)])).unwrap();
    let seq_before: i64 = tx
        .query_row("SELECT seq FROM rows WHERE pk = 'e'", [], |r| r.get(0))
        .unwrap();
    apply_sync(&tx, acct, &req(vec![change("events", "e", "{}", 400)])).unwrap();
    let seq_after: i64 = tx
        .query_row("SELECT seq FROM rows WHERE pk = 'e'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(seq_before, seq_after);
}

/// The point of accounts: two people on one server, same table and pk,
/// and neither ever pulls the other's rows as their own.
#[test]
fn accounts_are_isolated_from_each_other() {
    let mut c = mem(None);
    let alice = make_account(&c, "alice");
    let bob = make_account(&c, "bob");
    let tx = c.transaction().unwrap();

    apply_sync(
        &tx,
        alice,
        &req(vec![change("habits", "h1", "{\"name\":\"run\"}", 100)]),
    )
    .unwrap();
    apply_sync(
        &tx,
        bob,
        &req(vec![change("habits", "h1", "{\"name\":\"read\"}", 100)]),
    )
    .unwrap();

    let alice_pull = apply_sync(&tx, alice, &req(vec![])).unwrap();
    assert_eq!(alice_pull.changes.len(), 1);
    assert_eq!(alice_pull.changes[0].payload["name"], "run");
    assert!(alice_pull.shared.is_empty());

    let bob_pull = apply_sync(&tx, bob, &req(vec![])).unwrap();
    assert_eq!(bob_pull.changes.len(), 1);
    assert_eq!(bob_pull.changes[0].payload["name"], "read");
    assert!(bob_pull.shared.is_empty());
}

/// Multiple tokens resolve to the same account, and revoking one leaves
/// the others working — the per-device credential model.
#[test]
fn token_auth_via_tokens_table() {
    let c = mem(None);
    let alice = make_account(&c, "alice");
    let t1 = mint_token(&c, alice, "laptop").unwrap();
    let t2 = mint_token(&c, alice, "phone").unwrap();

    assert_eq!(account_for(&c, &auth_headers(&t1)), Some(alice));
    assert_eq!(account_for(&c, &auth_headers(&t2)), Some(alice));
    assert_eq!(account_for(&c, &auth_headers("wrong-token-000000")), None);

    c.execute(
        "DELETE FROM tokens WHERE token_hash = ?1",
        [token_hash(&t1)],
    )
    .unwrap();
    assert_eq!(account_for(&c, &auth_headers(&t1)), None);
    assert_eq!(account_for(&c, &auth_headers(&t2)), Some(alice));
}

/// `ALBAS_SYNC_TOKEN` keeps working: it creates the owner account on a
/// fresh database and re-keys the env credential when the value changes,
/// without touching tokens minted elsewhere (passkey logins).
#[test]
fn owner_token_bootstraps_and_rotates() {
    let mut c = mem(Some("first-owner-token-x"));
    let owner: i64 = c
        .query_row(
            "SELECT account_id FROM tokens WHERE token_hash = ?1",
            [token_hash("first-owner-token-x")],
            |r| r.get(0),
        )
        .unwrap();
    let device = mint_token(&c, owner, "passkey").unwrap();

    init_db(&mut c, Some("second-owner-token-x")).unwrap();
    let owner2: i64 = c
        .query_row(
            "SELECT account_id FROM tokens WHERE token_hash = ?1",
            [token_hash("second-owner-token-x")],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(owner, owner2, "rotation must re-key the same account");
    let old_env: Option<i64> = c
        .query_row(
            "SELECT id FROM tokens WHERE token_hash = ?1",
            [token_hash("first-owner-token-x")],
            |r| r.get(0),
        )
        .optional()
        .unwrap();
    assert!(old_env.is_none(), "the previous env token must be revoked");
    assert_eq!(
        account_for(&c, &auth_headers(&device)),
        Some(owner),
        "device tokens must survive env rotation"
    );
    let n: i64 = c
        .query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 1);
}

/// A pre-account database is migrated in place: rows land under `owner`
/// with their seq preserved, so existing clients' watermarks stay valid.
#[test]
fn legacy_v1_database_migrates_rows_to_owner() {
    let mut c = Connection::open_in_memory().unwrap();
    c.execute_batch(
        "CREATE TABLE rows (
           tbl TEXT NOT NULL, pk TEXT NOT NULL, payload TEXT NOT NULL,
           updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
           seq INTEGER NOT NULL, PRIMARY KEY (tbl, pk));
         CREATE INDEX rows_seq ON rows(seq);
         INSERT INTO rows VALUES ('habits', 'h1', '{\"name\":\"run\"}', 100, 0, 7);
         INSERT INTO rows VALUES ('tasks', 't1', '{\"title\":\"milk\"}', 200, 1, 8);",
    )
    .unwrap();

    assert!(
        init_db(&mut c, None).is_err(),
        "migration without ALBAS_SYNC_TOKEN must fail loudly, not orphan rows"
    );
    init_db(&mut c, Some("legacy-owner-token-x")).unwrap();

    let owner_id: i64 = c
        .query_row("SELECT id FROM accounts WHERE name = 'owner'", [], |r| {
            r.get(0)
        })
        .unwrap();
    let rows: Vec<(i64, String, i64)> = c
        .prepare("SELECT account_id, pk, seq FROM rows ORDER BY seq")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        rows,
        vec![(owner_id, "h1".into(), 7), (owner_id, "t1".into(), 8)]
    );
    assert_eq!(
        account_for(&c, &auth_headers("legacy-owner-token-x")),
        Some(owner_id)
    );

    // And a second startup is a no-op, not a second migration.
    init_db(&mut c, Some("legacy-owner-token-x")).unwrap();
    let n: i64 = c
        .query_row("SELECT COUNT(*) FROM rows", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 2);
}

/// The short-lived accounts schema that still kept `token_hash` on the
/// accounts table migrates its credentials into `tokens`.
#[test]
fn legacy_v2_accounts_schema_migrates_tokens_out() {
    let mut c = Connection::open_in_memory().unwrap();
    c.execute_batch(&format!(
        "CREATE TABLE accounts (
           id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
           token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
         CREATE TABLE rows (
           account_id INTEGER NOT NULL, tbl TEXT NOT NULL, pk TEXT NOT NULL,
           payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
           deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
           PRIMARY KEY (account_id, tbl, pk));
         CREATE INDEX rows_account_seq ON rows(account_id, seq);
         INSERT INTO accounts VALUES (1, 'owner', '{}', 10);
         INSERT INTO accounts VALUES (2, 'sarah', '{}', 20);
         INSERT INTO rows VALUES (2, 'habits', 'h1', '{{}}', 100, 0, 3);",
        token_hash("owner-env-token-xx"),
        token_hash("sarah-token-yyyyyy"),
    ))
    .unwrap();

    init_db(&mut c, Some("owner-env-token-xx")).unwrap();

    assert_eq!(
        account_for(&c, &auth_headers("owner-env-token-xx")),
        Some(1)
    );
    assert_eq!(
        account_for(&c, &auth_headers("sarah-token-yyyyyy")),
        Some(2)
    );
    let cols = table_columns(&c, "accounts").unwrap();
    assert!(!cols.iter().any(|n| n == "token_hash"));
    assert!(cols.iter().any(|n| n == "grant_rev"));
    // The owner's imported credential was claimed as the env token, not doubled.
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM tokens WHERE account_id = 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1);
    let label: String = c
        .query_row("SELECT label FROM tokens WHERE account_id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(label, "env");
    // Rows survived untouched.
    let seq: i64 = c
        .query_row("SELECT seq FROM rows WHERE pk = 'h1'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(seq, 3);
}

/// Sharing exposes exactly the granted table groups, to exactly the
/// grantee — never a table outside a group, never a third account.
#[test]
fn share_filtering_and_isolation() {
    let mut c = mem(None);
    let alice = make_account(&c, "alice");
    let bob = make_account(&c, "bob");
    let carol = make_account(&c, "carol");
    grant(&c, alice, bob, true, false); // calendar only
    let tx = c.transaction().unwrap();

    apply_sync(
        &tx,
        alice,
        &req(vec![
            change("events", "e1", "{\"title\":\"dinner\"}", 100),
            change("periods", "p1", "{\"name\":\"trip\"}", 100),
            change("habits", "h1", "{\"name\":\"run\"}", 100),
            change("scratch", "s1", "{\"n\":1}", 100),
        ]),
    )
    .unwrap();

    let bob_pull = apply_sync(
        &tx,
        bob,
        &SyncReq {
            since: 0,
            changes: vec![],
            shared_since: 0,
            grant_rev: 1,
        },
    )
    .unwrap();
    let tbls: Vec<&str> = bob_pull.shared.iter().map(|s| s.tbl.as_str()).collect();
    assert!(tbls.contains(&"events") && tbls.contains(&"periods"));
    assert!(!tbls.contains(&"habits"), "todos group was not granted");
    assert!(
        !tbls.contains(&"scratch"),
        "a table outside every group is never shareable"
    );
    assert!(bob_pull.shared.iter().all(|s| s.from == "alice"));
    assert!(
        bob_pull.changes.is_empty(),
        "shared rows must not appear as own rows"
    );

    let carol_pull = apply_sync(&tx, carol, &req(vec![])).unwrap();
    assert!(carol_pull.shared.is_empty(), "no grant, no data");
}

/// A grant-revision mismatch yields a full tombstone-free snapshot and the
/// new revision; a matching revision yields an incremental pull that does
/// carry tombstones.
#[test]
fn grant_rev_mismatch_sends_full_snapshot() {
    let mut c = mem(None);
    let alice = make_account(&c, "alice");
    let bob = make_account(&c, "bob");
    grant(&c, alice, bob, true, false);
    let tx = c.transaction().unwrap();

    apply_sync(
        &tx,
        alice,
        &req(vec![
            change("events", "e1", "{\"title\":\"kept\"}", 100),
            Change {
                deleted: true,
                ..change("events", "e2", "{\"title\":\"gone\"}", 100)
            },
        ]),
    )
    .unwrap();

    // Stale rev (0 ≠ 1): full snapshot, tombstone omitted.
    let stale = apply_sync(
        &tx,
        bob,
        &SyncReq {
            since: 0,
            changes: vec![],
            shared_since: 999,
            grant_rev: 0,
        },
    )
    .unwrap();
    assert_eq!(stale.grant_rev, 1);
    assert_eq!(
        stale.shared.len(),
        1,
        "sharedSince is ignored on mismatch; tombstones dropped"
    );
    assert_eq!(stale.shared[0].pk, "e1");

    // Matching rev: incremental from sharedSince, tombstones included.
    let shared_since = stale.shared_seq;
    apply_sync(
        &tx,
        alice,
        &req(vec![Change {
            deleted: true,
            ..change("events", "e1", "{}", 200)
        }]),
    )
    .unwrap();
    let incr = apply_sync(
        &tx,
        bob,
        &SyncReq {
            since: 0,
            changes: vec![],
            shared_since,
            grant_rev: 1,
        },
    )
    .unwrap();
    assert_eq!(incr.shared.len(), 1);
    assert!(
        incr.shared[0].deleted,
        "incremental pulls must carry tombstones"
    );
}

/// Changing or revoking a grant bumps the grantee's revision so their next
/// sync rebuilds the shared cache.
#[test]
fn share_changes_bump_grantee_rev() {
    let c = mem(None);
    let alice = make_account(&c, "alice");
    let bob = make_account(&c, "bob");
    let rev = |id: i64| -> i64 {
        c.query_row("SELECT grant_rev FROM accounts WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .unwrap()
    };
    assert_eq!(rev(bob), 0);
    grant(&c, alice, bob, true, true);
    assert_eq!(rev(bob), 1);
    grant(&c, alice, bob, true, false);
    assert_eq!(rev(bob), 2);
    assert_eq!(rev(alice), 0, "the owner's own rev is untouched");
}

#[test]
fn create_account_mints_a_token_whose_hash_is_stored() {
    let c = mem(None);
    let (id, token) = create_account_db(&c, " alice ").unwrap();
    let name: String = c
        .query_row("SELECT name FROM accounts WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(name, "alice", "trimmed");
    let (stored, label): (String, String) = c
        .query_row(
            "SELECT token_hash, label FROM tokens WHERE account_id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(stored, token_hash(&token));
    assert_eq!(label, "admin");
    assert_eq!(
        account_for(&c, &auth_headers(&token)),
        Some(id),
        "the printed token signs in"
    );

    assert!(matches!(
        create_account_db(&c, "alice"),
        Err(AdminError::Conflict(_))
    ));
    assert!(matches!(
        create_account_db(&c, "bad name!"),
        Err(AdminError::Invalid(_))
    ));
    assert!(matches!(
        create_account_db(&c, ""),
        Err(AdminError::Invalid(_))
    ));
}

/// Everything anchored to the account goes, grantees are bumped (before
/// the shares that identify them are deleted), and accounts that shared
/// *to* it are left alone.
#[test]
fn delete_account_cascades_and_bumps_grantees() {
    let c = mem(None);
    let alice = make_account(&c, "alice");
    let bob = make_account(&c, "bob");
    let carol = make_account(&c, "carol");
    mint_token(&c, alice, "laptop").unwrap();
    make_passkey(&c, alice, "cred1");
    c.execute(
        "INSERT INTO rows (account_id, tbl, pk, payload, updated_at, deleted, seq)
         VALUES (?1, 'habits', 'h1', '{}', 0, 0, 1)",
        [alice],
    )
    .unwrap();
    grant(&c, alice, bob, true, false); // alice -> bob: bob must rebuild
    grant(&c, carol, alice, true, true); // carol -> alice: carol is untouched
    let bob_rev = grant_rev(&c, bob);
    let carol_rev = grant_rev(&c, carol);

    assert!(matches!(
        delete_account_db(&c, "missing"),
        Err(AdminError::NotFound)
    ));
    delete_account_db(&c, "alice").unwrap();

    assert_eq!(grant_rev(&c, bob), bob_rev + 1);
    assert_eq!(grant_rev(&c, carol), carol_rev);
    let count = |sql: &str| -> i64 { c.query_row(sql, [alice], |r| r.get(0)).unwrap() };
    assert_eq!(count("SELECT COUNT(*) FROM accounts WHERE id = ?1"), 0);
    assert_eq!(count("SELECT COUNT(*) FROM rows WHERE account_id = ?1"), 0);
    assert_eq!(
        count("SELECT COUNT(*) FROM tokens WHERE account_id = ?1"),
        0
    );
    assert_eq!(
        count("SELECT COUNT(*) FROM passkeys WHERE account_id = ?1"),
        0
    );
    assert_eq!(
        count("SELECT COUNT(*) FROM shares WHERE owner_id = ?1 OR grantee_id = ?1"),
        0
    );
    assert!(matches!(
        delete_account_db(&c, "alice"),
        Err(AdminError::NotFound)
    ));
}

/// `account list` needs tokens, passkeys and a row count inline — this is
/// the whole reason the listing grew past `{name, created_at}`.
#[test]
fn list_accounts_includes_tokens_passkeys_and_rows() {
    let c = mem(None);
    let alice = make_account(&c, "alice");
    mint_token(&c, alice, "laptop").unwrap();
    make_passkey(&c, alice, "cred1");
    c.execute(
        "INSERT INTO rows (account_id, tbl, pk, payload, updated_at, deleted, seq)
         VALUES (?1, 'habits', 'h1', '{}', 0, 0, 1)",
        [alice],
    )
    .unwrap();
    c.execute(
        "UPDATE accounts SET totp_secret = 's', totp_confirmed = 0 WHERE id = ?1",
        [alice],
    )
    .unwrap();

    let out = list_accounts_db(&c).unwrap();
    let acct = out.iter().find(|a| a.name == "alice").unwrap();
    assert_eq!(acct.tokens.len(), 1);
    assert_eq!(acct.tokens[0].label, "laptop");
    assert_eq!(acct.passkeys.len(), 1);
    assert_eq!(acct.row_count, 1);
    assert!(!acct.has_password);
    assert!(!acct.totp_enabled, "unconfirmed enrollment reads as off");
}

/// The admin pair is named explicitly, listed server-wide, and still bumps
/// the grantee's `grant_rev` like the self-service routes do.
#[test]
fn set_share_upserts_then_removes() {
    let c = mem(None);
    let alice = make_account(&c, "alice");
    let bob = make_account(&c, "bob");

    set_share_db(&c, "alice", "bob", true, false).unwrap();
    let list = list_shares_db(&c).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(
        (list[0].owner_name.as_str(), list[0].grantee_name.as_str()),
        ("alice", "bob")
    );
    assert!(list[0].calendar && !list[0].todos);
    assert_eq!(grant_rev(&c, bob), 1);

    set_share_db(&c, "alice", "bob", true, true).unwrap();
    let list = list_shares_db(&c).unwrap();
    assert_eq!(list.len(), 1, "upsert, not a second row");
    assert!(list[0].todos);
    assert_eq!(grant_rev(&c, bob), 2);

    set_share_db(&c, "alice", "bob", false, false).unwrap();
    assert!(list_shares_db(&c).unwrap().is_empty());
    assert_eq!(grant_rev(&c, bob), 3, "removal bumps too");
    assert_eq!(grant_rev(&c, alice), 0, "the owner's own rev is untouched");

    assert!(matches!(
        set_share_db(&c, "alice", "nobody", true, true),
        Err(AdminError::NotFound)
    ));
    assert!(matches!(
        set_share_db(&c, "alice", "alice", true, true),
        Err(AdminError::Invalid(_))
    ));
}

#[test]
fn label_revoke_and_clear_totp_are_scoped_to_the_named_account() {
    let c = mem(None);
    let alice = make_account(&c, "alice");
    make_account(&c, "bob");
    let pk = make_passkey(&c, alice, "cred1");
    mint_token(&c, alice, "laptop").unwrap();
    let tok: i64 = c
        .query_row(
            "SELECT id FROM tokens WHERE account_id = ?1",
            [alice],
            |r| r.get(0),
        )
        .unwrap();
    c.execute(
        "UPDATE accounts SET totp_secret = 's', totp_confirmed = 1 WHERE id = ?1",
        [alice],
    )
    .unwrap();

    assert!(matches!(
        label_passkey_db(&c, "bob", pk, Some("x")),
        Err(AdminError::NotFound)
    ));
    assert!(matches!(
        label_passkey_db(&c, "alice", pk, Some(&"x".repeat(65))),
        Err(AdminError::Invalid(_))
    ));
    label_passkey_db(&c, "alice", pk, Some(" YubiKey ")).unwrap();
    let label: Option<String> = c
        .query_row("SELECT label FROM passkeys WHERE id = ?1", [pk], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(label.as_deref(), Some("YubiKey"));
    label_passkey_db(&c, "alice", pk, None).unwrap();
    let label: Option<String> = c
        .query_row("SELECT label FROM passkeys WHERE id = ?1", [pk], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(label, None, "no label clears back to the derived name");

    assert!(matches!(
        revoke_token_db(&c, "bob", tok),
        Err(AdminError::NotFound)
    ));
    revoke_token_db(&c, "alice", tok).unwrap();
    let left: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM tokens WHERE account_id = ?1",
            [alice],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(left, 0);

    assert!(matches!(
        clear_totp_db(&c, "missing"),
        Err(AdminError::NotFound)
    ));
    clear_totp_db(&c, "alice").unwrap();
    let (secret, confirmed): (Option<String>, i64) = c
        .query_row(
            "SELECT totp_secret, totp_confirmed FROM accounts WHERE id = ?1",
            [alice],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert!(secret.is_none() && confirmed == 0);
}
