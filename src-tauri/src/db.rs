use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Db(pub Mutex<Connection>);

/// updated_at/deleted never leave Rust: they exist for sync (`sync.rs` pushes
/// by `updated_at` and tombstones by `deleted`), and the frontend only ever
/// sees live rows.
const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  completed INTEGER NOT NULL DEFAULT 0,
  date TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color_key TEXT NOT NULL DEFAULT 'primary',
  kind TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  target REAL NOT NULL DEFAULT 1,
  schedule TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reminder INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  time TEXT,
  category TEXT NOT NULL DEFAULT '',
  important INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS habit_completions (
  habit_id TEXT NOT NULL,
  date TEXT NOT NULL,
  value REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (habit_id, date)
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color_key TEXT NOT NULL DEFAULT 'primary',
  all_day INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  start_time TEXT,
  end_date TEXT NOT NULL,
  end_time TEXT,
  recurrence TEXT NOT NULL DEFAULT '{\"type\":\"none\"}',
  reminders TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS periods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color_key TEXT NOT NULL DEFAULT 'primary',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  habit_ids TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
";

/// v5 addition (device sync sharing): a read-only cache of rows other accounts
/// shared with this one. Filled by `sync.rs` from the server's `shared` stream,
/// never pushed (deliberately absent from `sync::TABLES`), and parsed into
/// typed objects on the frontend (`sharedLogic.ts`). `owner` is the sharing
/// account's name; `pk` is the server's opaque key (composite keys joined with
/// U+0001, as in `sync.rs`).
const SCHEMA_V5: &str = "
CREATE TABLE IF NOT EXISTS shared_rows (
  owner TEXT NOT NULL,
  tbl TEXT NOT NULL,
  pk TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, tbl, pk)
);
";

/// v6 addition (custom categories): a synced table of user-defined groupings
/// shared by to-dos, habits, and events — `scopes` is a CSV of
/// `calendar|tasks|habits` saying which. `habits.category` / `events.category`
/// now hold a category **id** (empty = none) instead of free text; `tasks`
/// (legacy, import-only) is untouched since nothing writes new rows there.
const SCHEMA_V6: &str = "
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color_key TEXT NOT NULL,
  scopes TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0
);
";

/// The full current schema, for tests that need a throwaway in-memory DB.
#[cfg(test)]
pub fn test_schema() -> String {
    format!("{SCHEMA}{SCHEMA_V5}{SCHEMA_V6}")
}

pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    // SCHEMA is kept at the current shape, so a fresh database gets every
    // column outright and the ALTERs below are only for upgrading an existing
    // one. Running them on a fresh DB would fail with "duplicate column name".
    if version < 1 {
        conn.execute_batch(SCHEMA)?;
    } else {
        // v2 (todo unification): habits became unified to-dos with an
        // optional due day (once to-dos) and time of day.
        if version < 2 {
            conn.execute_batch(
                "ALTER TABLE habits ADD COLUMN due_date TEXT;
                 ALTER TABLE habits ADD COLUMN time TEXT;",
            )?;
        }
        // v4 (categorised to-dos): a category id and the star. v3 was a
        // frontend-only shape change and added no columns.
        if version < 4 {
            conn.execute_batch(
                "ALTER TABLE habits ADD COLUMN category TEXT NOT NULL DEFAULT '';
                 ALTER TABLE habits ADD COLUMN important INTEGER NOT NULL DEFAULT 0;",
            )?;
        }
        // v6 (custom categories): events gained a category column too; a
        // fresh database gets it straight from SCHEMA above instead.
        if version < 6 {
            conn.execute_batch("ALTER TABLE events ADD COLUMN category TEXT NOT NULL DEFAULT '';")?;
        }
    }
    // v7: weight tracking was removed; drop its table wherever it still exists.
    conn.execute_batch("DROP TABLE IF EXISTS weights;")?;
    // v5 (shared rows cache). CREATE TABLE IF NOT EXISTS, so replaying is
    // harmless.
    if version < 5 {
        conn.execute_batch(SCHEMA_V5)?;
    }
    // v6 (custom categories). CREATE TABLE IF NOT EXISTS, so replaying is
    // harmless — same pattern as v5.
    if version < 6 {
        conn.execute_batch(SCHEMA_V6)?;
    }
    conn.pragma_update(None, "user_version", 7)?;
    repoint_default_server(&conn)?;
    Ok(conn)
}

/// Endpoints this build has shipped as its default, oldest first, each paired
/// with nothing but its own string — a device that was signed in when one of
/// these was current has it *stored* in `__sync_url`, and a stored value always
/// beats `sync::DEFAULT_URL`. Without this, moving the server would leave every
/// existing install quietly syncing to a host that no longer answers, with no
/// error to explain it and no clue that the Server field needed retyping.
///
/// Only an untouched former default is rewritten. Anyone self-hosting has a URL
/// that appears nowhere in this list, so their setting is left alone.
const SUPERSEDED_URLS: &[&str] = &["https://albas-api.danni-dev.com/sync"];

/// Runs once per former default, flagged so a person who deliberately types an
/// old URL back in doesn't have it taken away again on the next launch.
///
/// The second sweep is unflagged and unconditional, and deliberately so: since
/// `check_url` dropped its loopback exemption there is no longer any `http://`
/// URL the app will accept, so a stored one cannot have been typed back in on
/// purpose — it can only be a leftover from local testing, sitting in front of
/// `DEFAULT_URL` and syncing to a machine that isn't listening.
fn repoint_default_server(conn: &Connection) -> rusqlite::Result<()> {
    for old in SUPERSEDED_URLS {
        let flag = format!("repointed:{old}");
        if read_meta(conn, &flag).is_some() {
            continue;
        }
        if read_setting(conn, crate::sync::URL_SETTING).as_deref() == Some(*old) {
            write_setting(conn, crate::sync::URL_SETTING, crate::sync::DEFAULT_URL)?;
        }
        write_meta(conn, &flag, "1")?;
    }
    if let Some(stored) = read_setting(conn, crate::sync::URL_SETTING)
        && crate::sync::check_url(&stored).is_err()
    {
        write_setting(conn, crate::sync::URL_SETTING, crate::sync::DEFAULT_URL)?;
    }
    Ok(())
}

/// User preferences live in `meta` under this prefix so they can't collide with
/// internal bookkeeping keys like `legacy_import_done`.
const SETTING_PREFIX: &str = "setting:";
/// Where `token_store.rs` keeps the real bearer token on mobile (no keyring
/// there). Never handed to the WebView: `load_state` filters it out and
/// `set_setting` refuses it, so the token only ever moves through
/// `token_store::{get,set,clear}`.
pub(crate) const TOKEN_SECRET_SETTING: &str = "__sync_token_secret";

/// Unprefixed `meta` access, for bookkeeping the frontend never sees —
/// `legacy_import_done`, the sync watermarks. Settings go through the
/// prefixed pair below.
pub fn read_meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| {
        r.get::<_, String>(0)
    })
    .ok()
}

pub fn write_meta(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    )?;
    Ok(())
}

pub fn read_setting(conn: &Connection, key: &str) -> Option<String> {
    read_meta(conn, &format!("{SETTING_PREFIX}{key}"))
}

pub fn write_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    write_meta(conn, &format!("{SETTING_PREFIX}{key}"), value)
}

#[tauri::command]
pub fn set_setting(db: tauri::State<Db>, key: String, value: String) -> Result<(), String> {
    // The token secret and the signed-in marker belong to `token_store.rs`;
    // a frontend write to either would desynchronise them from the keyring.
    if key == TOKEN_SECRET_SETTING || key == crate::sync::TOKEN_SETTING {
        return Err(format!(
            "{key} is managed by the app and cannot be set directly."
        ));
    }
    let conn = db.0.lock().map_err(err)?;
    write_setting(&conn, &key, &value).map_err(err)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub category: String,
    pub completed: bool,
    pub date: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Habit {
    pub id: String,
    pub name: String,
    pub color_key: String,
    pub kind: String,
    pub unit: String,
    pub target: f64,
    pub schedule: serde_json::Value,
    pub created_at: String,
    pub reminder: bool,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub time: Option<String>,
    /// Free-text grouping for to-dos; empty means uncategorised.
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub important: bool,
    #[serde(default)]
    pub completions: HashMap<String, f64>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub title: String,
    pub description: String,
    pub color_key: String,
    pub all_day: bool,
    pub start_date: String,
    pub start_time: Option<String>,
    pub end_date: String,
    pub end_time: Option<String>,
    pub recurrence: serde_json::Value,
    pub reminders: serde_json::Value,
    /// Category id; empty means uncategorised. Mirrors `habits.category`.
    #[serde(default)]
    pub category: String,
}

/// A user-defined grouping shared by to-dos, habits, and events. `scopes` is
/// a CSV of `calendar|tasks|habits` — kept as a plain string column (like
/// every other JSON/CSV-ish column here) rather than a join table, since the
/// server never parses payloads and a join table would need its own sync
/// handling. `created_at` (the DB column) never reaches JSON, same as
/// `updated_at`/`deleted` — nothing on the frontend needs it, so
/// `upsert_category` stamps it once on insert and leaves it alone after.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub color_key: String,
    pub scopes: String,
    pub sort: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Period {
    pub id: String,
    pub name: String,
    pub color_key: String,
    pub start_date: String,
    pub end_date: String,
    pub notes: String,
    pub habit_ids: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    pub tasks: Vec<Task>,
    pub habits: Vec<Habit>,
    pub events: Vec<Event>,
    pub periods: Vec<Period>,
    pub categories: Vec<Category>,
    pub settings: HashMap<String, String>,
    pub needs_legacy_import: bool,
}

fn json_col(v: &serde_json::Value) -> String {
    v.to_string()
}

fn parse_json(s: String) -> serde_json::Value {
    serde_json::from_str(&s).unwrap_or(serde_json::Value::Null)
}

#[tauri::command]
pub fn load_state(db: tauri::State<Db>) -> Result<AppData, String> {
    let conn = db.0.lock().map_err(err)?;

    let tasks = conn
        .prepare("SELECT id, title, category, completed, date FROM tasks WHERE deleted = 0")
        .map_err(err)?
        .query_map([], |r| {
            Ok(Task {
                id: r.get(0)?,
                title: r.get(1)?,
                category: r.get(2)?,
                completed: r.get::<_, i64>(3)? != 0,
                date: r.get(4)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;

    let mut completions: HashMap<String, HashMap<String, f64>> = HashMap::new();
    conn.prepare(
        "SELECT habit_id, date, value FROM habit_completions WHERE deleted = 0 AND value > 0",
    )
    .map_err(err)?
    .query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, f64>(2)?,
        ))
    })
    .map_err(err)?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(err)?
    .into_iter()
    .for_each(|(habit_id, date, value)| {
        completions.entry(habit_id).or_default().insert(date, value);
    });

    let habits = conn
        .prepare("SELECT id, name, color_key, kind, unit, target, schedule, created_at, reminder, due_date, time, category, important FROM habits WHERE deleted = 0")
        .map_err(err)?
        .query_map([], |r| {
            Ok(Habit {
                id: r.get(0)?,
                name: r.get(1)?,
                color_key: r.get(2)?,
                kind: r.get(3)?,
                unit: r.get(4)?,
                target: r.get(5)?,
                schedule: parse_json(r.get(6)?),
                created_at: r.get(7)?,
                reminder: r.get::<_, i64>(8)? != 0,
                due_date: r.get(9)?,
                time: r.get(10)?,
                category: r.get(11)?,
                important: r.get::<_, i64>(12)? != 0,
                completions: HashMap::new(),
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?
        .into_iter()
        .map(|mut h| {
            h.completions = completions.remove(&h.id).unwrap_or_default();
            h
        })
        .collect();

    let events = conn
        .prepare("SELECT id, title, description, color_key, all_day, start_date, start_time, end_date, end_time, recurrence, reminders, category FROM events WHERE deleted = 0")
        .map_err(err)?
        .query_map([], |r| {
            Ok(Event {
                id: r.get(0)?,
                title: r.get(1)?,
                description: r.get(2)?,
                color_key: r.get(3)?,
                all_day: r.get::<_, i64>(4)? != 0,
                start_date: r.get(5)?,
                start_time: r.get(6)?,
                end_date: r.get(7)?,
                end_time: r.get(8)?,
                recurrence: parse_json(r.get(9)?),
                reminders: parse_json(r.get(10)?),
                category: r.get(11)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;

    let periods = conn
        .prepare("SELECT id, name, color_key, start_date, end_date, notes, habit_ids FROM periods WHERE deleted = 0")
        .map_err(err)?
        .query_map([], |r| {
            Ok(Period {
                id: r.get(0)?,
                name: r.get(1)?,
                color_key: r.get(2)?,
                start_date: r.get(3)?,
                end_date: r.get(4)?,
                notes: r.get(5)?,
                habit_ids: parse_json(r.get(6)?),
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;

    let categories = conn
        .prepare("SELECT id, name, color_key, scopes, sort FROM categories WHERE deleted = 0")
        .map_err(err)?
        .query_map([], |r| {
            Ok(Category {
                id: r.get(0)?,
                name: r.get(1)?,
                color_key: r.get(2)?,
                scopes: r.get(3)?,
                sort: r.get(4)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;

    let settings = conn
        .prepare("SELECT key, value FROM meta WHERE key LIKE 'setting:%' AND key != ?1")
        .map_err(err)?
        .query_map([format!("{SETTING_PREFIX}{TOKEN_SECRET_SETTING}")], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?
        .into_iter()
        .map(|(k, v)| (k[SETTING_PREFIX.len()..].to_string(), v))
        .collect();

    let needs_legacy_import = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'legacy_import_done'",
            [],
            |r| r.get::<_, String>(0),
        )
        .is_err();

    Ok(AppData {
        tasks,
        habits,
        events,
        periods,
        categories,
        settings,
        needs_legacy_import,
    })
}

fn upsert_task(conn: &Connection, t: &Task) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO tasks (id, title, category, completed, date, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
         ON CONFLICT(id) DO UPDATE SET title=?2, category=?3, completed=?4, date=?5, updated_at=?6, deleted=0",
        params![t.id, t.title, t.category, t.completed as i64, t.date, now_ms()],
    )?;
    Ok(())
}

fn upsert_habit(conn: &Connection, h: &Habit) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO habits (id, name, color_key, kind, unit, target, schedule, created_at, reminder, due_date, time, category, important, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 0)
         ON CONFLICT(id) DO UPDATE SET name=?2, color_key=?3, kind=?4, unit=?5, target=?6, schedule=?7, created_at=?8, reminder=?9, due_date=?10, time=?11, category=?12, important=?13, updated_at=?14, deleted=0",
        params![
            h.id, h.name, h.color_key, h.kind, h.unit, h.target,
            json_col(&h.schedule), h.created_at, h.reminder as i64,
            h.due_date, h.time, h.category, h.important as i64, now_ms()
        ],
    )?;
    Ok(())
}

fn upsert_completion(
    conn: &Connection,
    habit_id: &str,
    date: &str,
    value: f64,
) -> rusqlite::Result<()> {
    // value <= 0 tombstones the row instead of deleting it, so sync can propagate the clear
    conn.execute(
        "INSERT INTO habit_completions (habit_id, date, value, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(habit_id, date) DO UPDATE SET value=?3, updated_at=?4, deleted=?5",
        params![
            habit_id,
            date,
            value.max(0.0),
            now_ms(),
            (value <= 0.0) as i64
        ],
    )?;
    Ok(())
}

fn tombstone(conn: &Connection, table: &str, id: &str) -> rusqlite::Result<()> {
    // table is always a compile-time constant from the commands below
    conn.execute(
        &format!("UPDATE {table} SET deleted = 1, updated_at = ?1 WHERE id = ?2"),
        params![now_ms(), id],
    )?;
    Ok(())
}

/// Settings › Danger zone: tombstone every live event (and every legacy
/// period, which the frontend folds into events on load). One transaction and
/// one `updated_at`, so the push after this carries the whole wipe as one
/// batch of tombstones and other devices delete the same rows.
fn wipe_events(conn: &Connection) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    let now = now_ms();
    tx.execute(
        "UPDATE events SET deleted = 1, updated_at = ?1 WHERE deleted = 0",
        params![now],
    )?;
    tx.execute(
        "UPDATE periods SET deleted = 1, updated_at = ?1 WHERE deleted = 0",
        params![now],
    )?;
    tx.commit()
}

/// Settings › Danger zone: tombstone every live to-do of one kind. Tasks and
/// habits share the `habits` table, told apart by the JSON `schedule` column
/// (`{"type":"once"}` is a task — the same test as `isRepeating` in
/// `src/todoLogic.ts`). Completions go with their rows.
fn wipe_todos(conn: &Connection, kind: &str) -> Result<(), String> {
    let cmp = match kind {
        "task" => "=",
        "habit" => "!=",
        other => return Err(format!("unknown to-do kind {other:?}")),
    };
    let tx = conn.unchecked_transaction().map_err(err)?;
    let now = now_ms();
    tx.execute(
        &format!(
            "UPDATE habit_completions SET deleted = 1, updated_at = ?1
             WHERE deleted = 0 AND habit_id IN (
               SELECT id FROM habits WHERE deleted = 0 AND json_extract(schedule, '$.type') {cmp} 'once')"
        ),
        params![now],
    )
    .map_err(err)?;
    tx.execute(
        &format!(
            "UPDATE habits SET deleted = 1, updated_at = ?1
             WHERE deleted = 0 AND json_extract(schedule, '$.type') {cmp} 'once'"
        ),
        params![now],
    )
    .map_err(err)?;
    tx.commit().map_err(err)
}

#[tauri::command]
pub fn delete_all_events(db: tauri::State<Db>) -> Result<(), String> {
    wipe_events(&*db.0.lock().map_err(err)?).map_err(err)
}

#[tauri::command]
pub fn delete_all_todos(db: tauri::State<Db>, kind: String) -> Result<(), String> {
    wipe_todos(&*db.0.lock().map_err(err)?, &kind)
}

#[tauri::command]
pub fn save_task(db: tauri::State<Db>, task: Task) -> Result<(), String> {
    upsert_task(&*db.0.lock().map_err(err)?, &task).map_err(err)
}

#[tauri::command]
pub fn delete_task(db: tauri::State<Db>, id: String) -> Result<(), String> {
    tombstone(&*db.0.lock().map_err(err)?, "tasks", &id).map_err(err)
}

#[tauri::command]
pub fn save_habit(db: tauri::State<Db>, habit: Habit) -> Result<(), String> {
    upsert_habit(&*db.0.lock().map_err(err)?, &habit).map_err(err)
}

#[tauri::command]
pub fn delete_habit(db: tauri::State<Db>, id: String) -> Result<(), String> {
    tombstone(&*db.0.lock().map_err(err)?, "habits", &id).map_err(err)
}

#[tauri::command]
pub fn set_completion(
    db: tauri::State<Db>,
    habit_id: String,
    date: String,
    value: f64,
) -> Result<(), String> {
    upsert_completion(&*db.0.lock().map_err(err)?, &habit_id, &date, value).map_err(err)
}

#[tauri::command]
pub fn save_event(db: tauri::State<Db>, event: Event) -> Result<(), String> {
    let conn = db.0.lock().map_err(err)?;
    conn.execute(
        "INSERT INTO events (id, title, description, color_key, all_day, start_date, start_time, end_date, end_time, recurrence, reminders, category, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 0)
         ON CONFLICT(id) DO UPDATE SET title=?2, description=?3, color_key=?4, all_day=?5, start_date=?6, start_time=?7, end_date=?8, end_time=?9, recurrence=?10, reminders=?11, category=?12, updated_at=?13, deleted=0",
        params![
            event.id, event.title, event.description, event.color_key, event.all_day as i64,
            event.start_date, event.start_time, event.end_date, event.end_time,
            json_col(&event.recurrence), json_col(&event.reminders), event.category, now_ms()
        ],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_event(db: tauri::State<Db>, id: String) -> Result<(), String> {
    tombstone(&*db.0.lock().map_err(err)?, "events", &id).map_err(err)
}

fn upsert_category(conn: &Connection, c: &Category) -> rusqlite::Result<()> {
    // created_at is stamped only on insert (the `?6` binding); the DO UPDATE
    // branch deliberately omits it from the SET list, so an edit never
    // disturbs the row's original creation time.
    conn.execute(
        "INSERT INTO categories (id, name, color_key, scopes, sort, created_at, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, 0)
         ON CONFLICT(id) DO UPDATE SET name=?2, color_key=?3, scopes=?4, sort=?5, updated_at=?6, deleted=0",
        params![c.id, c.name, c.color_key, c.scopes, c.sort, now_ms()],
    )?;
    Ok(())
}

#[tauri::command]
pub fn list_categories(db: tauri::State<Db>) -> Result<Vec<Category>, String> {
    let conn = db.0.lock().map_err(err)?;
    let mut stmt = conn
        .prepare("SELECT id, name, color_key, scopes, sort FROM categories WHERE deleted = 0")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Category {
                id: r.get(0)?,
                name: r.get(1)?,
                color_key: r.get(2)?,
                scopes: r.get(3)?,
                sort: r.get(4)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub fn save_category(db: tauri::State<Db>, category: Category) -> Result<(), String> {
    upsert_category(&*db.0.lock().map_err(err)?, &category).map_err(err)
}

#[tauri::command]
pub fn delete_category(db: tauri::State<Db>, id: String) -> Result<(), String> {
    tombstone(&*db.0.lock().map_err(err)?, "categories", &id).map_err(err)
}

#[tauri::command]
pub fn save_period(db: tauri::State<Db>, period: Period) -> Result<(), String> {
    let conn = db.0.lock().map_err(err)?;
    conn.execute(
        "INSERT INTO periods (id, name, color_key, start_date, end_date, notes, habit_ids, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)
         ON CONFLICT(id) DO UPDATE SET name=?2, color_key=?3, start_date=?4, end_date=?5, notes=?6, habit_ids=?7, updated_at=?8, deleted=0",
        params![
            period.id, period.name, period.color_key, period.start_date,
            period.end_date, period.notes, json_col(&period.habit_ids), now_ms()
        ],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_period(db: tauri::State<Db>, id: String) -> Result<(), String> {
    tombstone(&*db.0.lock().map_err(err)?, "periods", &id).map_err(err)
}

/// One-time import of the pre-SQLite localStorage blob. Transactional and
/// guarded by a meta flag so StrictMode double-effects can't import twice.
#[tauri::command]
pub fn import_legacy(
    db: tauri::State<Db>,
    tasks: Vec<Task>,
    habits: Vec<Habit>,
) -> Result<(), String> {
    let mut guard = db.0.lock().map_err(err)?;
    let tx = guard.transaction().map_err(err)?;
    let already: bool = tx
        .query_row(
            "SELECT value FROM meta WHERE key = 'legacy_import_done'",
            [],
            |r| r.get::<_, String>(0),
        )
        .is_ok();
    if !already {
        for t in &tasks {
            upsert_task(&tx, t).map_err(err)?;
        }
        for h in &habits {
            upsert_habit(&tx, h).map_err(err)?;
            for (date, value) in &h.completions {
                upsert_completion(&tx, &h.id, date, *value).map_err(err)?;
            }
        }
        tx.execute(
            "INSERT INTO meta (key, value) VALUES ('legacy_import_done', '1')",
            [],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)
}

/// One raw row another account shared with this one. The payload is the
/// column-name → value object the server relayed; the frontend
/// (`sharedLogic.ts`) turns it into typed events/todos.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedRow {
    pub owner: String,
    pub tbl: String,
    pub pk: String,
    pub payload: serde_json::Value,
}

#[tauri::command]
pub fn load_shared(db: tauri::State<Db>) -> Result<Vec<SharedRow>, String> {
    let conn = db.0.lock().map_err(err)?;
    let mut stmt = conn
        .prepare("SELECT owner, tbl, pk, payload FROM shared_rows WHERE deleted = 0")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SharedRow {
                owner: r.get(0)?,
                tbl: r.get(1)?,
                pk: r.get(2)?,
                payload: serde_json::from_str(&r.get::<_, String>(3)?)
                    .unwrap_or(serde_json::Value::Null),
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(&test_schema()).unwrap();
        conn.execute_batch(
            "INSERT INTO habits (id, name, kind, schedule, created_at, updated_at)
             VALUES ('t1', 'task', 'yesno', '{\"type\":\"once\"}', '2026-01-01', 1),
                    ('h1', 'habit', 'yesno', '{\"type\":\"daily\"}', '2026-01-01', 1);
             INSERT INTO habit_completions (habit_id, date, value, updated_at)
             VALUES ('t1', '2026-01-02', 1, 1), ('h1', '2026-01-02', 1, 1);
             INSERT INTO events (id, title, start_date, end_date, updated_at)
             VALUES ('e1', 'event', '2026-01-01', '2026-01-01', 1);",
        )
        .unwrap();
        conn
    }

    fn live(conn: &Connection, table: &str, id_col: &str) -> Vec<String> {
        let mut st = conn
            .prepare(&format!(
                "SELECT {id_col} FROM {table} WHERE deleted = 0 ORDER BY 1"
            ))
            .unwrap();
        st.query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    #[test]
    fn wipe_tasks_leaves_habits() {
        let c = conn();
        wipe_todos(&c, "task").unwrap();
        assert_eq!(live(&c, "habits", "id"), ["h1"]);
        assert_eq!(live(&c, "habit_completions", "habit_id"), ["h1"]);
        // A tombstone is a newer write: it must outrank the row it replaces.
        let ts: i64 = c
            .query_row("SELECT updated_at FROM habits WHERE id = 't1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(ts > 1);
    }

    #[test]
    fn wipe_habits_leaves_tasks() {
        let c = conn();
        wipe_todos(&c, "habit").unwrap();
        assert_eq!(live(&c, "habits", "id"), ["t1"]);
        assert_eq!(live(&c, "habit_completions", "habit_id"), ["t1"]);
    }

    #[test]
    fn wipe_rejects_unknown_kind() {
        assert!(wipe_todos(&conn(), "period").is_err());
    }

    #[test]
    fn wipe_events_tombstones_every_event() {
        let c = conn();
        wipe_events(&c).unwrap();
        assert!(live(&c, "events", "id").is_empty());
    }

    /// A database file `open()` can be pointed at, deleted with its WAL
    /// sidecars when the test ends.
    struct TempDb(std::path::PathBuf);

    impl TempDb {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("albas-db-test-{}-{tag}.sqlite", std::process::id()));
            for suffix in ["", "-wal", "-shm"] {
                let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
            }
            TempDb(path)
        }
    }

    impl Drop for TempDb {
        fn drop(&mut self) {
            for suffix in ["", "-wal", "-shm"] {
                let _ = std::fs::remove_file(format!("{}{suffix}", self.0.display()));
            }
        }
    }

    /// The schema as it shipped at `user_version` 1: before to-dos gained
    /// `due_date`/`time` (v2) and `category`/`important` (v4), before the
    /// shared-rows cache (v5), events' `category` and the categories table
    /// (v6), and while weight tracking still had a table (dropped in v7).
    const SCHEMA_V1: &str = "
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General', completed INTEGER NOT NULL DEFAULT 0,
  date TEXT, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE habits (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color_key TEXT NOT NULL DEFAULT 'primary',
  kind TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '', target REAL NOT NULL DEFAULT 1,
  schedule TEXT NOT NULL, created_at TEXT NOT NULL, reminder INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE habit_completions (
  habit_id TEXT NOT NULL, date TEXT NOT NULL, value REAL NOT NULL,
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (habit_id, date));
CREATE TABLE events (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  color_key TEXT NOT NULL DEFAULT 'primary', all_day INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL, start_time TEXT, end_date TEXT NOT NULL, end_time TEXT,
  recurrence TEXT NOT NULL DEFAULT '{\"type\":\"none\"}',
  reminders TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE periods (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color_key TEXT NOT NULL DEFAULT 'primary',
  start_date TEXT NOT NULL, end_date TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
  habit_ids TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE weights (date TEXT PRIMARY KEY, kg REAL NOT NULL, updated_at INTEGER NOT NULL);
PRAGMA user_version = 1;
";

    fn columns(conn: &Connection, table: &str) -> Vec<String> {
        conn.prepare(&format!("SELECT name FROM pragma_table_info('{table}')"))
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    fn tables(conn: &Connection) -> Vec<String> {
        conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    fn user_version(conn: &Connection) -> i64 {
        conn.pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap()
    }

    const CURRENT_VERSION: i64 = 7;

    /// Every table an upgraded database has, with the columns it has, must
    /// match a database created fresh from `SCHEMA` — the CLAUDE.md rule that
    /// `SCHEMA` stays at the current shape and the `ALTER`s reproduce it.
    /// Column *order* legitimately differs (`ADD COLUMN` appends, `SCHEMA`
    /// groups), and nothing here selects `*` or inserts positionally.
    fn assert_same_shape(upgraded: &Connection, fresh: &Connection) {
        assert_eq!(tables(upgraded), tables(fresh));
        for table in tables(fresh) {
            let mut have = columns(upgraded, &table);
            let mut want = columns(fresh, &table);
            have.sort();
            want.sort();
            assert_eq!(have, want, "columns of {table}");
        }
    }

    #[test]
    fn fresh_database_is_at_the_current_version() {
        let db = TempDb::new("fresh");
        let c = open(&db.0).unwrap();
        assert_eq!(user_version(&c), CURRENT_VERSION);
        assert!(tables(&c).contains(&"categories".to_string()));
        assert!(!tables(&c).contains(&"weights".to_string()));
        // Reopening neither re-runs an ALTER (which would fail on a duplicate
        // column) nor moves the version.
        drop(c);
        let c = open(&db.0).unwrap();
        assert_eq!(user_version(&c), CURRENT_VERSION);
    }

    #[test]
    fn a_version_1_database_upgrades_to_the_fresh_shape_keeping_its_rows() {
        let old = TempDb::new("v1");
        {
            let c = Connection::open(&old.0).unwrap();
            c.execute_batch(SCHEMA_V1).unwrap();
            c.execute_batch(
                "INSERT INTO habits (id, name, kind, schedule, created_at, updated_at)
                 VALUES ('h1', 'run', 'yesno', '{\"type\":\"daily\"}', '2026-01-01', 1);
                 INSERT INTO habit_completions (habit_id, date, value, updated_at)
                 VALUES ('h1', '2026-01-02', 1, 1);
                 INSERT INTO events (id, title, start_date, end_date, updated_at)
                 VALUES ('e1', 'dentist', '2026-01-03', '2026-01-03', 1);
                 INSERT INTO weights VALUES ('2026-01-01', 80.5, 1);
                 INSERT INTO meta VALUES ('legacy_import_done', '1');",
            )
            .unwrap();
        }
        let fresh = TempDb::new("v1-fresh");
        let fresh = open(&fresh.0).unwrap();

        let c = open(&old.0).unwrap();
        assert_eq!(user_version(&c), CURRENT_VERSION);
        assert_same_shape(&c, &fresh);

        // Rows survive with the new columns at their defaults.
        let (name, category, important, due): (String, String, i64, Option<String>) = c
            .query_row(
                "SELECT name, category, important, due_date FROM habits WHERE id = 'h1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            (name.as_str(), category.as_str(), important, due),
            ("run", "", 0, None)
        );
        let event_category: String = c
            .query_row("SELECT category FROM events WHERE id = 'e1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(event_category, "");
        assert_eq!(live(&c, "habit_completions", "habit_id"), ["h1"]);
        assert_eq!(read_meta(&c, "legacy_import_done").as_deref(), Some("1"));

        // A second open is a no-op.
        drop(c);
        let c = open(&old.0).unwrap();
        assert_eq!(user_version(&c), CURRENT_VERSION);
        assert_same_shape(&c, &fresh);
    }

    /// The v5/v6 steps are `CREATE TABLE IF NOT EXISTS` and column adds; a
    /// database that already took the v2 and v4 steps must get only what it
    /// still lacks.
    #[test]
    fn a_version_4_database_gets_only_the_later_steps() {
        let old = TempDb::new("v4");
        {
            let c = Connection::open(&old.0).unwrap();
            c.execute_batch(SCHEMA_V1).unwrap();
            c.execute_batch(
                "ALTER TABLE habits ADD COLUMN due_date TEXT;
                 ALTER TABLE habits ADD COLUMN time TEXT;
                 ALTER TABLE habits ADD COLUMN category TEXT NOT NULL DEFAULT '';
                 ALTER TABLE habits ADD COLUMN important INTEGER NOT NULL DEFAULT 0;
                 INSERT INTO habits (id, name, kind, schedule, created_at, updated_at, due_date, important)
                 VALUES ('t1', 'milk', 'yesno', '{\"type\":\"once\"}', '2026-01-01', 1, '2026-02-01', 1);
                 PRAGMA user_version = 4;",
            )
            .unwrap();
        }
        let fresh = TempDb::new("v4-fresh");
        let fresh = open(&fresh.0).unwrap();

        let c = open(&old.0).unwrap();
        assert_eq!(user_version(&c), CURRENT_VERSION);
        assert_same_shape(&c, &fresh);
        let (due, important): (Option<String>, i64) = c
            .query_row(
                "SELECT due_date, important FROM habits WHERE id = 't1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((due.as_deref(), important), (Some("2026-02-01"), 1));
    }
}
