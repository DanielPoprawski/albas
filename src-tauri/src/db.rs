use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Db(pub Mutex<Connection>);

/// updated_at/deleted never leave Rust: they exist for the future sync server,
/// and the frontend only ever sees live rows.
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

pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version < 1 {
        conn.execute_batch(SCHEMA)?;
        conn.pragma_update(None, "user_version", 1)?;
    }
    Ok(conn)
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
    conn.prepare("SELECT habit_id, date, value FROM habit_completions WHERE deleted = 0 AND value > 0")
        .map_err(err)?
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, f64>(2)?))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?
        .into_iter()
        .for_each(|(habit_id, date, value)| {
            completions.entry(habit_id).or_default().insert(date, value);
        });

    let habits = conn
        .prepare("SELECT id, name, color_key, kind, unit, target, schedule, created_at, reminder FROM habits WHERE deleted = 0")
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
        .prepare("SELECT id, title, description, color_key, all_day, start_date, start_time, end_date, end_time, recurrence, reminders FROM events WHERE deleted = 0")
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

    let needs_legacy_import = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'legacy_import_done'",
            [],
            |r| r.get::<_, String>(0),
        )
        .is_err();

    Ok(AppData { tasks, habits, events, periods, needs_legacy_import })
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
        "INSERT INTO habits (id, name, color_key, kind, unit, target, schedule, created_at, reminder, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0)
         ON CONFLICT(id) DO UPDATE SET name=?2, color_key=?3, kind=?4, unit=?5, target=?6, schedule=?7, created_at=?8, reminder=?9, updated_at=?10, deleted=0",
        params![
            h.id, h.name, h.color_key, h.kind, h.unit, h.target,
            json_col(&h.schedule), h.created_at, h.reminder as i64, now_ms()
        ],
    )?;
    Ok(())
}

fn upsert_completion(conn: &Connection, habit_id: &str, date: &str, value: f64) -> rusqlite::Result<()> {
    // value <= 0 tombstones the row instead of deleting it, so sync can propagate the clear
    conn.execute(
        "INSERT INTO habit_completions (habit_id, date, value, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(habit_id, date) DO UPDATE SET value=?3, updated_at=?4, deleted=?5",
        params![habit_id, date, value.max(0.0), now_ms(), (value <= 0.0) as i64],
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
pub fn set_completion(db: tauri::State<Db>, habit_id: String, date: String, value: f64) -> Result<(), String> {
    upsert_completion(&*db.0.lock().map_err(err)?, &habit_id, &date, value).map_err(err)
}

#[tauri::command]
pub fn save_event(db: tauri::State<Db>, event: Event) -> Result<(), String> {
    let conn = db.0.lock().map_err(err)?;
    conn.execute(
        "INSERT INTO events (id, title, description, color_key, all_day, start_date, start_time, end_date, end_time, recurrence, reminders, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0)
         ON CONFLICT(id) DO UPDATE SET title=?2, description=?3, color_key=?4, all_day=?5, start_date=?6, start_time=?7, end_date=?8, end_time=?9, recurrence=?10, reminders=?11, updated_at=?12, deleted=0",
        params![
            event.id, event.title, event.description, event.color_key, event.all_day as i64,
            event.start_date, event.start_time, event.end_date, event.end_time,
            json_col(&event.recurrence), json_col(&event.reminders), now_ms()
        ],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_event(db: tauri::State<Db>, id: String) -> Result<(), String> {
    tombstone(&*db.0.lock().map_err(err)?, "events", &id).map_err(err)
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
pub fn import_legacy(db: tauri::State<Db>, tasks: Vec<Task>, habits: Vec<Habit>) -> Result<(), String> {
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
