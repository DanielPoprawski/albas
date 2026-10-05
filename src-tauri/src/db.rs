use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Db(pub Mutex<Connection>);

/// updated_at/deleted never leave Rust: they exist for sync (`sync.rs` pushes
/// by `updated_at` and tombstones by `deleted`), and the frontend only ever
/// sees live rows.
const SCHEMA_META: &str = "
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
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

/// v6 addition (custom categories), kept only so a pre-v6 database can walk
/// the ladder: v10 folds `categories` into `lists` and never reads it again.
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

/// v10 (seeds): to-dos, habits and events are one table. `color` is a named
/// key ('' = inherit from the last tag, else grey), `list` a list id ('' =
/// unfiled), `tags` a JSON array of tag ids, `repeat`/`reminders` JSON, and
/// `track` the JSON doable rule ('' = not doable, i.e. an event). `done` holds
/// one row per completed occurrence. The pre-v10 tables (`tasks`, `habits`,
/// `habit_completions`, `events`, `periods`, `categories`) stay in an upgraded
/// file untouched — never dropped — but nothing reads or syncs them.
const SCHEMA_V10: &str = "
CREATE TABLE IF NOT EXISTS seeds (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  list TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  important INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  routine TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  date TEXT,
  time TEXT,
  end_date TEXT,
  end_time TEXT,
  repeat TEXT NOT NULL DEFAULT '{\"type\":\"none\"}',
  track TEXT NOT NULL DEFAULT '',
  reminders TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS done (
  seed_id TEXT NOT NULL,
  date TEXT NOT NULL,
  value REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (seed_id, date)
);
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'grey',
  icon TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  keywords TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
";

const CURRENT_VERSION: i64 = 11;

/// The full current schema, for tests that need a throwaway in-memory DB.
#[cfg(test)]
pub fn test_schema() -> String {
    format!("{SCHEMA_META}{SCHEMA_V5}{SCHEMA_V10}")
}

pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version < 1 {
        // A fresh file gets only the current tables; the ladder below exists
        // to bring an older file's legacy tables to the shape `migrate_v10`
        // reads, and running its ALTERs here would fail on missing tables.
        conn.execute_batch(SCHEMA_META)?;
        conn.execute_batch(SCHEMA_V5)?;
        conn.execute_batch(SCHEMA_V10)?;
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
        // v6 (custom categories): events gained a category column too.
        if version < 6 {
            conn.execute_batch("ALTER TABLE events ADD COLUMN category TEXT NOT NULL DEFAULT '';")?;
        }
        // v8 (to-do notes): free text on a task or habit, the counterpart of an
        // event's description.
        if version < 8 {
            conn.execute_batch("ALTER TABLE habits ADD COLUMN notes TEXT NOT NULL DEFAULT '';")?;
        }
        // v9 (habits own their look): a manual order and a routine tag.
        if version < 9 {
            conn.execute_batch(
                "ALTER TABLE habits ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE habits ADD COLUMN routine TEXT NOT NULL DEFAULT '';",
            )?;
        }
        // v7: weight tracking was removed; drop its table wherever it still exists.
        conn.execute_batch("DROP TABLE IF EXISTS weights;")?;
        // v5 (shared rows cache) and v6 (custom categories): CREATE TABLE IF
        // NOT EXISTS, so replaying is harmless.
        if version < 5 {
            conn.execute_batch(SCHEMA_V5)?;
        }
        if version < 6 {
            conn.execute_batch(SCHEMA_V6)?;
        }
        // v9: habits stopped borrowing their category's colour. Copy it into
        // each repeating to-do's own `color_key` once so nothing changes on
        // screen; needs the categories table, hence after the v6 step.
        if version < 9 {
            conn.execute(
                "UPDATE habits SET
                   color_key = (SELECT c.color_key FROM categories c WHERE c.id = habits.category AND c.deleted = 0),
                   updated_at = ?1
                 WHERE category != '' AND schedule NOT LIKE '%once%'
                   AND EXISTS (SELECT 1 FROM categories c WHERE c.id = habits.category AND c.deleted = 0)",
                params![now_ms()],
            )?;
        }
        // v10 (seeds): create the new tables and copy every live row across.
        if version < 10 {
            conn.execute_batch(SCHEMA_V10)?;
            migrate_v10(&conn)?;
        }
        // v11: tag keywords. Below v10 the column came with `SCHEMA_V10`. The
        // bump re-pushes every tag, so no server row lacks the column (a pull
        // would read one as a newer schema and park).
        if version < 11 {
            if version == 10 {
                conn.execute_batch(
                    "ALTER TABLE tags ADD COLUMN keywords TEXT NOT NULL DEFAULT '';",
                )?;
            }
            conn.execute("UPDATE tags SET updated_at = ?1", params![now_ms()])?;
        }
    }
    conn.pragma_update(None, "user_version", CURRENT_VERSION)?;
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
/// internal bookkeeping keys like the sync watermarks.
const SETTING_PREFIX: &str = "setting:";
/// Where `token_store.rs` keeps the real bearer token on mobile (no keyring
/// there). Never handed to the WebView: `load_state` filters it out and
/// `set_setting` refuses it, so the token only ever moves through
/// `token_store::{get,set,clear}`.
pub(crate) const TOKEN_SECRET_SETTING: &str = "__sync_token_secret";

/// Unprefixed `meta` access, for bookkeeping the frontend never sees — the
/// sync watermarks. Settings go through the prefixed pair below.
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

// --- v10 migration ----------------------------------------------------------

/// The named colour nearest to a pre-v10 `color_key`. Those were hexes from a
/// picker (or the three legacy names), so this is a one-way snap: neutrals by
/// lightness, everything else by hue distance to the eight palette hues.
fn snap_color(key: &str) -> &'static str {
    match key {
        "primary" => return "purple",
        "secondary" => return "green",
        "tertiary" => return "pink",
        _ => {}
    }
    let Some((h, s, l)) = hex_to_hsl(key) else {
        return "grey";
    };
    if s < 0.15 {
        return if l < 0.2 {
            "ink"
        } else if l > 0.9 {
            "paper"
        } else if l < 0.5 {
            "grey-dark"
        } else {
            "grey"
        };
    }
    const HUES: [(&str, f64); 8] = [
        ("red", 0.0),
        ("orange", 30.0),
        ("yellow", 55.0),
        ("green", 150.0),
        ("teal", 190.0),
        ("blue", 220.0),
        ("purple", 275.0),
        ("pink", 330.0),
    ];
    HUES.iter()
        .map(|(name, centre)| {
            let d = (h - centre).abs() % 360.0;
            (*name, d.min(360.0 - d))
        })
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(name, _)| name)
        .unwrap_or("grey")
}

/// `#rgb` or `#rrggbb` → (hue in degrees, saturation, lightness), or None.
fn hex_to_hsl(hex: &str) -> Option<(f64, f64, f64)> {
    let digits = hex.strip_prefix('#')?;
    let expanded: String = match digits.len() {
        3 => digits.chars().flat_map(|c| [c, c]).collect(),
        6 => digits.to_string(),
        _ => return None,
    };
    let channel = |i: usize| u8::from_str_radix(&expanded[i..i + 2], 16).ok();
    let (r, g, b) = (channel(0)?, channel(2)?, channel(4)?);
    let (r, g, b) = (r as f64 / 255.0, g as f64 / 255.0, b as f64 / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    let d = max - min;
    if d == 0.0 {
        return Some((0.0, 0.0, l));
    }
    let s = d / (1.0 - (2.0 * l - 1.0).abs());
    let h = if max == r {
        60.0 * (((g - b) / d) % 6.0)
    } else if max == g {
        60.0 * ((b - r) / d + 2.0)
    } else {
        60.0 * ((r - g) / d + 4.0)
    };
    Some(((h + 360.0) % 360.0, s, l))
}

fn json_num(v: &serde_json::Value, key: &str, default: i64) -> i64 {
    match v.get(key).and_then(|n| n.as_f64()) {
        Some(n) if n >= 1.0 => n as i64,
        _ => default,
    }
}

fn json_days(v: &serde_json::Value) -> Vec<i64> {
    v.get("days")
        .and_then(|d| d.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|d| d.as_i64())
                .filter(|d| (0..=6).contains(d))
                .collect()
        })
        .unwrap_or_default()
}

fn every(n: i64, unit: &str) -> serde_json::Value {
    serde_json::json!({ "type": "every", "n": n, "unit": unit })
}

/// A to-do's `schedule` (v1–v9 shape, plus the two pre-unification ones the
/// frontend used to repair on load) → a v10 `repeat`.
fn schedule_to_repeat(schedule: &str) -> serde_json::Value {
    let s: serde_json::Value = serde_json::from_str(schedule).unwrap_or(serde_json::Value::Null);
    let kind = s.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match kind {
        "once" => serde_json::json!({ "type": "none" }),
        "daily" => every(1, "day"),
        "weekdays" => {
            let mut days = json_days(&s);
            if days.is_empty() {
                days = vec![1, 2, 3, 4, 5];
            }
            let mut r = every(1, "week");
            r["days"] = serde_json::json!(days);
            r
        }
        "interval" | "chore" => {
            let mut r = every(json_num(&s, "every", 1), "day");
            if kind == "chore" {
                r["fromDone"] = serde_json::json!(true);
            }
            r
        }
        "every" => {
            let unit = s
                .get("unit")
                .and_then(|u| u.as_str())
                .filter(|u| matches!(*u, "week" | "month"))
                .unwrap_or("day");
            let mut r = every(json_num(&s, "n", 1), unit);
            if s.get("fromDone").and_then(|f| f.as_bool()) == Some(true) {
                r["fromDone"] = serde_json::json!(true);
            }
            r
        }
        "timesPer" => serde_json::json!({
            "type": "timesPer",
            "times": json_num(&s, "times", 1),
            "per": if s.get("per").and_then(|p| p.as_str()) == Some("month") { "month" } else { "week" },
        }),
        _ => every(1, "day"),
    }
}

/// An event's `recurrence` → a v10 `repeat`, carrying `until` and `exdates`.
fn recurrence_to_repeat(recurrence: &str) -> serde_json::Value {
    let s: serde_json::Value = serde_json::from_str(recurrence).unwrap_or(serde_json::Value::Null);
    let n = json_num(&s, "interval", 1);
    let mut r = match s.get("type").and_then(|t| t.as_str()).unwrap_or("none") {
        "daily" => every(n, "day"),
        "weekdays" => {
            let mut r = every(n, "week");
            r["days"] = serde_json::json!([1, 2, 3, 4, 5]);
            r
        }
        "weekly" => {
            let mut r = every(n, "week");
            let days = json_days(&s);
            if !days.is_empty() {
                r["days"] = serde_json::json!(days);
            }
            r
        }
        "monthly" => every(n, "month"),
        "yearly" => every(n, "year"),
        _ => return serde_json::json!({ "type": "none" }),
    };
    if let Some(until) = s.get("until").and_then(|u| u.as_str()) {
        r["until"] = serde_json::json!(until);
    }
    if let Some(ex) = s.get("exdates").and_then(|e| e.as_array())
        && !ex.is_empty()
    {
        r["exdates"] = serde_json::Value::Array(ex.clone());
    }
    r
}

type HabitRow = (
    String,
    String,
    String,
    String,
    String,
    f64,
    String,
    String,
    i64,
    Option<String>,
    Option<String>,
    String,
    i64,
    String,
    i64,
    String,
    i64,
);

type EventRow = (
    String,
    String,
    String,
    i64,
    String,
    Option<String>,
    String,
    Option<String>,
    String,
    String,
    String,
    i64,
);

/// Copies every live pre-v10 row into the seed tables, keeping ids and
/// `updated_at`, then zeroes the push watermark so the whole set goes to the
/// server once. Old tables are left as they were.
fn migrate_v10(conn: &Connection) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;

    // Categories → lists, and a lookup for the colour a categorised event or
    // once to-do painted with (habits already own theirs since v9).
    tx.execute(
        "INSERT OR IGNORE INTO lists (id, name, sort, updated_at, deleted)
         SELECT id, name, sort, updated_at, 0 FROM categories WHERE deleted = 0",
        [],
    )?;
    let category_colors: HashMap<String, String> = tx
        .prepare("SELECT id, color_key FROM categories WHERE deleted = 0")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    // Events and once to-dos painted from their category, or the neutral grey
    // when they had none — so an uncategorised one gets no colour of its own
    // (null) rather than the purple default its `color_key` column held.
    let painted = |category: &str| -> String {
        category_colors
            .get(category)
            .map(|c| snap_color(c).to_string())
            .unwrap_or_default()
    };

    const INSERT_SEED: &str = "INSERT OR IGNORE INTO seeds
        (id, title, notes, color, list, tags, important, sort, routine, created_at,
         date, time, end_date, end_time, repeat, track, reminders, updated_at, deleted)
        VALUES (?1, ?2, ?3, ?4, ?5, '[]', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 0)";

    // To-dos and habits.
    let habits: Vec<HabitRow> = tx
        .prepare(
            "SELECT id, name, color_key, kind, unit, target, schedule, created_at, reminder, due_date, time,
                    category, important, notes, sort, routine, updated_at
             FROM habits WHERE deleted = 0",
        )?
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
                r.get(8)?,
                r.get(9)?,
                r.get(10)?,
                r.get(11)?,
                r.get(12)?,
                r.get(13)?,
                r.get(14)?,
                r.get(15)?,
                r.get(16)?,
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;
    for (
        id,
        name,
        color_key,
        kind,
        unit,
        target,
        schedule,
        created_at,
        reminder,
        due_date,
        time,
        category,
        important,
        notes,
        sort,
        routine,
        updated_at,
    ) in habits
    {
        let repeat = schedule_to_repeat(&schedule);
        let once = repeat["type"] == "none";
        let date = if once {
            due_date
        } else {
            Some(due_date.unwrap_or_else(|| created_at.clone()))
        };
        let color = if once {
            painted(&category)
        } else {
            snap_color(&color_key).to_string()
        };
        let track = if kind == "measurable" {
            serde_json::json!({ "kind": "count", "unit": unit, "target": target })
        } else {
            serde_json::json!({ "kind": "check" })
        };
        tx.execute(
            INSERT_SEED,
            params![
                id,
                name,
                notes,
                color,
                category,
                important,
                sort,
                routine,
                created_at,
                date,
                time,
                Option::<String>::None,
                Option::<String>::None,
                repeat.to_string(),
                track.to_string(),
                if reminder != 0 { "[0]" } else { "[]" },
                updated_at
            ],
        )?;
    }

    // Events.
    let events: Vec<EventRow> = tx
        .prepare(
            "SELECT id, title, description, all_day, start_date, start_time, end_date, end_time,
                    recurrence, reminders, category, updated_at
             FROM events WHERE deleted = 0",
        )?
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
                r.get(8)?,
                r.get(9)?,
                r.get(10)?,
                r.get(11)?,
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;
    for (
        id,
        title,
        description,
        all_day,
        start_date,
        start_time,
        end_date,
        end_time,
        recurrence,
        reminders,
        category,
        updated_at,
    ) in events
    {
        let all_day = all_day != 0;
        let end_date = (end_date != start_date).then_some(end_date);
        let reminders: serde_json::Value =
            serde_json::from_str(&reminders).unwrap_or_else(|_| serde_json::json!([]));
        tx.execute(
            INSERT_SEED,
            params![
                id,
                title,
                description,
                painted(&category),
                category,
                0,
                0,
                "",
                start_date,
                Some(start_date.clone()),
                if all_day { None } else { start_time },
                end_date,
                if all_day { None } else { end_time },
                recurrence_to_repeat(&recurrence).to_string(),
                "",
                reminders.to_string(),
                updated_at
            ],
        )?;
    }

    // Legacy once tasks (import-only table; normally empty by now) and
    // periods (all-day spans the frontend already showed as events).
    tx.execute(
        "INSERT OR IGNORE INTO seeds (id, title, created_at, date, track, updated_at)
         SELECT id, title, COALESCE(date, date('now')), date, '{\"kind\":\"check\"}', updated_at
         FROM tasks WHERE deleted = 0",
        [],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO done (seed_id, date, value, updated_at, deleted)
         SELECT id, COALESCE(date, date('now')), 1, updated_at, 0
         FROM tasks WHERE deleted = 0 AND completed != 0",
        [],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO seeds (id, title, notes, created_at, date, end_date, updated_at)
         SELECT id, name, notes, start_date, start_date,
                CASE WHEN end_date != start_date THEN end_date END, updated_at
         FROM periods WHERE deleted = 0",
        [],
    )?;

    // Completions follow their rows.
    tx.execute(
        "INSERT OR IGNORE INTO done (seed_id, date, value, updated_at, deleted)
         SELECT habit_id, date, value, updated_at, 0 FROM habit_completions
         WHERE deleted = 0 AND habit_id IN (SELECT id FROM seeds)",
        [],
    )?;

    write_meta(&tx, crate::sync::META_PUSH_AT, "0")?;
    tx.commit()
}

// --- rows -------------------------------------------------------------------

/// One thing on the timeline. `color`/`track` are `None`/`Null` where the
/// column holds '' (see `SCHEMA_V10`); `tags`, `repeat`, `reminders` are the
/// JSON the frontend wrote, passed through untouched.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Seed {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub list: String,
    pub tags: serde_json::Value,
    #[serde(default)]
    pub important: bool,
    #[serde(default)]
    pub sort: i64,
    #[serde(default)]
    pub routine: String,
    pub created_at: String,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub time: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default)]
    pub end_time: Option<String>,
    pub repeat: serde_json::Value,
    #[serde(default)]
    pub track: serde_json::Value,
    pub reminders: serde_json::Value,
    #[serde(default)]
    pub done: HashMap<String, f64>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct List {
    pub id: String,
    pub name: String,
    pub sort: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub sort: i64,
    #[serde(default)]
    pub keywords: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    pub seeds: Vec<Seed>,
    pub lists: Vec<List>,
    pub tags: Vec<Tag>,
    pub settings: HashMap<String, String>,
}

fn parse_json(s: String) -> serde_json::Value {
    serde_json::from_str(&s).unwrap_or(serde_json::Value::Null)
}

/// `track` column ↔ JSON: '' is "not doable", which the frontend sees as null.
fn track_col(v: &serde_json::Value) -> String {
    if v.is_null() {
        String::new()
    } else {
        v.to_string()
    }
}

#[tauri::command]
pub fn load_state(db: tauri::State<Db>) -> Result<AppData, String> {
    let conn = db.0.lock().map_err(err)?;

    let mut done: HashMap<String, HashMap<String, f64>> = HashMap::new();
    conn.prepare("SELECT seed_id, date, value FROM done WHERE deleted = 0 AND value > 0")
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
        .for_each(|(seed_id, date, value)| {
            done.entry(seed_id).or_default().insert(date, value);
        });

    let seeds = conn
        .prepare(
            "SELECT id, title, notes, color, list, tags, important, sort, routine, created_at,
                    date, time, end_date, end_time, repeat, track, reminders
             FROM seeds WHERE deleted = 0",
        )
        .map_err(err)?
        .query_map([], |r| {
            let color: String = r.get(3)?;
            let track: String = r.get(15)?;
            Ok(Seed {
                id: r.get(0)?,
                title: r.get(1)?,
                notes: r.get(2)?,
                color: (!color.is_empty()).then_some(color),
                list: r.get(4)?,
                tags: parse_json(r.get(5)?),
                important: r.get::<_, i64>(6)? != 0,
                sort: r.get(7)?,
                routine: r.get(8)?,
                created_at: r.get(9)?,
                date: r.get(10)?,
                time: r.get(11)?,
                end_date: r.get(12)?,
                end_time: r.get(13)?,
                repeat: parse_json(r.get(14)?),
                track: if track.is_empty() {
                    serde_json::Value::Null
                } else {
                    parse_json(track)
                },
                reminders: parse_json(r.get(16)?),
                done: HashMap::new(),
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?
        .into_iter()
        .map(|mut s| {
            s.done = done.remove(&s.id).unwrap_or_default();
            s
        })
        .collect();

    let lists = conn
        .prepare("SELECT id, name, sort FROM lists WHERE deleted = 0")
        .map_err(err)?
        .query_map([], |r| {
            Ok(List {
                id: r.get(0)?,
                name: r.get(1)?,
                sort: r.get(2)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;

    let tags = conn
        .prepare("SELECT id, name, color, icon, sort, keywords FROM tags WHERE deleted = 0")
        .map_err(err)?
        .query_map([], |r| {
            Ok(Tag {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                icon: r.get(3)?,
                sort: r.get(4)?,
                keywords: r.get(5)?,
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

    Ok(AppData {
        seeds,
        lists,
        tags,
        settings,
    })
}

fn upsert_seed(conn: &Connection, s: &Seed) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO seeds (id, title, notes, color, list, tags, important, sort, routine, created_at,
             date, time, end_date, end_time, repeat, track, reminders, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, 0)
         ON CONFLICT(id) DO UPDATE SET title=?2, notes=?3, color=?4, list=?5, tags=?6, important=?7,
             sort=?8, routine=?9, created_at=?10, date=?11, time=?12, end_date=?13, end_time=?14,
             repeat=?15, track=?16, reminders=?17, updated_at=?18, deleted=0",
        params![
            s.id,
            s.title,
            s.notes,
            s.color.clone().unwrap_or_default(),
            s.list,
            s.tags.to_string(),
            s.important as i64,
            s.sort,
            s.routine,
            s.created_at,
            s.date,
            s.time,
            s.end_date,
            s.end_time,
            s.repeat.to_string(),
            track_col(&s.track),
            s.reminders.to_string(),
            now_ms()
        ],
    )?;
    Ok(())
}

fn upsert_done(conn: &Connection, seed_id: &str, date: &str, value: f64) -> rusqlite::Result<()> {
    // value <= 0 tombstones the row instead of deleting it, so sync can propagate the clear
    conn.execute(
        "INSERT INTO done (seed_id, date, value, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(seed_id, date) DO UPDATE SET value=?3, updated_at=?4, deleted=?5",
        params![
            seed_id,
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

/// Settings › Danger zone: tombstone every live seed of one kind — the same
/// three filters the views use (`track` empty = event; otherwise `repeat`
/// none = to-do, else habit). Done rows go with their seeds, in one
/// transaction with one `updated_at`, so the push after this carries the
/// whole wipe as one batch of tombstones and other devices delete the same rows.
fn wipe_seeds(conn: &Connection, kind: &str) -> Result<(), String> {
    let filter = match kind {
        "events" => "track = ''",
        "todos" => "track != '' AND json_extract(repeat, '$.type') = 'none'",
        "habits" => "track != '' AND json_extract(repeat, '$.type') != 'none'",
        other => return Err(format!("unknown seed kind {other:?}")),
    };
    let tx = conn.unchecked_transaction().map_err(err)?;
    let now = now_ms();
    tx.execute(
        &format!(
            "UPDATE done SET deleted = 1, updated_at = ?1
             WHERE deleted = 0 AND seed_id IN (SELECT id FROM seeds WHERE deleted = 0 AND {filter})"
        ),
        params![now],
    )
    .map_err(err)?;
    tx.execute(
        &format!("UPDATE seeds SET deleted = 1, updated_at = ?1 WHERE deleted = 0 AND {filter}"),
        params![now],
    )
    .map_err(err)?;
    tx.commit().map_err(err)
}

#[tauri::command]
pub fn delete_all(db: tauri::State<Db>, kind: String) -> Result<(), String> {
    wipe_seeds(&*db.0.lock().map_err(err)?, &kind)
}

#[tauri::command]
pub fn save_seed(db: tauri::State<Db>, seed: Seed) -> Result<(), String> {
    upsert_seed(&*db.0.lock().map_err(err)?, &seed).map_err(err)
}

#[tauri::command]
pub fn delete_seed(db: tauri::State<Db>, id: String) -> Result<(), String> {
    tombstone(&*db.0.lock().map_err(err)?, "seeds", &id).map_err(err)
}

#[tauri::command]
pub fn set_done(
    db: tauri::State<Db>,
    seed_id: String,
    date: String,
    value: f64,
) -> Result<(), String> {
    upsert_done(&*db.0.lock().map_err(err)?, &seed_id, &date, value).map_err(err)
}

#[tauri::command]
pub fn save_list(db: tauri::State<Db>, list: List) -> Result<(), String> {
    let conn = db.0.lock().map_err(err)?;
    conn.execute(
        "INSERT INTO lists (id, name, sort, updated_at, deleted) VALUES (?1, ?2, ?3, ?4, 0)
         ON CONFLICT(id) DO UPDATE SET name=?2, sort=?3, updated_at=?4, deleted=0",
        params![list.id, list.name, list.sort, now_ms()],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_list(db: tauri::State<Db>, id: String) -> Result<(), String> {
    tombstone(&*db.0.lock().map_err(err)?, "lists", &id).map_err(err)
}

#[tauri::command]
pub fn save_tag(db: tauri::State<Db>, tag: Tag) -> Result<(), String> {
    let conn = db.0.lock().map_err(err)?;
    conn.execute(
        "INSERT INTO tags (id, name, color, icon, sort, keywords, updated_at, deleted) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)
         ON CONFLICT(id) DO UPDATE SET name=?2, color=?3, icon=?4, sort=?5, keywords=?6, updated_at=?7, deleted=0",
        params![tag.id, tag.name, tag.color, tag.icon, tag.sort, tag.keywords, now_ms()],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_tag(db: tauri::State<Db>, id: String) -> Result<(), String> {
    tombstone(&*db.0.lock().map_err(err)?, "tags", &id).map_err(err)
}

/// One raw row another account shared with this one. The payload is the
/// column-name → value object the server relayed; the frontend
/// (`sharedLogic.ts`) turns it into typed seeds, lists and tags.
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
            "INSERT INTO seeds (id, title, created_at, repeat, track, updated_at)
             VALUES ('t1', 'task', '2026-01-01', '{\"type\":\"none\"}', '{\"kind\":\"check\"}', 1),
                    ('h1', 'habit', '2026-01-01', '{\"type\":\"every\",\"n\":1,\"unit\":\"day\"}', '{\"kind\":\"check\"}', 1),
                    ('e1', 'event', '2026-01-01', '{\"type\":\"none\"}', '', 1);
             INSERT INTO done (seed_id, date, value, updated_at)
             VALUES ('t1', '2026-01-02', 1, 1), ('h1', '2026-01-02', 1, 1);",
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
    fn wipe_todos_leaves_habits() {
        let c = conn();
        wipe_seeds(&c, "todos").unwrap();
        assert_eq!(live(&c, "seeds", "id"), ["e1", "h1"]);
        assert_eq!(live(&c, "done", "seed_id"), ["h1"]);
        // A tombstone is a newer write: it must outrank the row it replaces.
        let ts: i64 = c
            .query_row("SELECT updated_at FROM seeds WHERE id = 't1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(ts > 1);
    }

    #[test]
    fn wipe_habits_leaves_todos() {
        let c = conn();
        wipe_seeds(&c, "habits").unwrap();
        assert_eq!(live(&c, "seeds", "id"), ["e1", "t1"]);
        assert_eq!(live(&c, "done", "seed_id"), ["t1"]);
    }

    #[test]
    fn wipe_events_leaves_doables() {
        let c = conn();
        wipe_seeds(&c, "events").unwrap();
        assert_eq!(live(&c, "seeds", "id"), ["h1", "t1"]);
        assert_eq!(live(&c, "done", "seed_id"), ["h1", "t1"]);
    }

    #[test]
    fn wipe_rejects_unknown_kind() {
        assert!(wipe_seeds(&conn(), "periods").is_err());
    }

    #[test]
    fn snap_color_picks_nearest_hue_and_grey_for_neutrals() {
        assert_eq!(snap_color("#ef4444"), "red");
        assert_eq!(snap_color("#f59e0b"), "orange");
        assert_eq!(snap_color("#eab308"), "yellow");
        assert_eq!(snap_color("#10b981"), "green");
        assert_eq!(snap_color("#06b6d4"), "teal");
        assert_eq!(snap_color("#3b82f6"), "blue");
        assert_eq!(snap_color("#a855f7"), "purple");
        assert_eq!(snap_color("#ec4899"), "pink");
        assert_eq!(snap_color("#f00"), "red");
        assert_eq!(snap_color("#000000"), "ink");
        assert_eq!(snap_color("#ffffff"), "paper");
        assert_eq!(snap_color("#4b5563"), "grey-dark");
        assert_eq!(snap_color("#9ca3af"), "grey");
        assert_eq!(snap_color("primary"), "purple");
        assert_eq!(snap_color("secondary"), "green");
        assert_eq!(snap_color("tertiary"), "pink");
        assert_eq!(snap_color("not a colour"), "grey");
        assert_eq!(snap_color(""), "grey");
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
    /// (v6), to-do `notes` (v8), and while weight tracking still had a table
    /// (dropped in v7).
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

    /// The steps v1 → v9 took, so a test can build a v9 file without going
    /// through `open()` (which would carry it straight to v10).
    const V1_TO_V9: &str = "
ALTER TABLE habits ADD COLUMN due_date TEXT;
ALTER TABLE habits ADD COLUMN time TEXT;
ALTER TABLE habits ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE habits ADD COLUMN important INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE habits ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE habits ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;
ALTER TABLE habits ADD COLUMN routine TEXT NOT NULL DEFAULT '';
DROP TABLE weights;
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

    /// Every table a fresh database has must exist in an upgraded one with the
    /// same columns — the CLAUDE.md rule that the schema constants stay at the
    /// current shape and the ladder reproduces it. An upgraded file keeps its
    /// legacy tables on top (never dropped), and column *order* legitimately
    /// differs (`ADD COLUMN` appends); nothing here selects `*` or inserts
    /// positionally.
    fn assert_same_shape(upgraded: &Connection, fresh: &Connection) {
        for table in tables(fresh) {
            assert!(
                tables(upgraded).contains(&table),
                "{table} missing after upgrade"
            );
            let mut have = columns(upgraded, &table);
            let mut want = columns(fresh, &table);
            have.sort();
            want.sort();
            assert_eq!(have, want, "columns of {table}");
        }
    }

    type SeedRow = (
        String,
        String,
        Option<String>,
        Option<String>,
        String,
        String,
        String,
    );

    /// (title, color, date, end_date, repeat, track, reminders) of a live seed.
    fn seed_row(c: &Connection, id: &str) -> SeedRow {
        c.query_row(
            "SELECT title, color, date, end_date, repeat, track, reminders FROM seeds WHERE id = ?1 AND deleted = 0",
            [id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            },
        )
        .unwrap()
    }

    #[test]
    fn fresh_database_is_at_the_current_version() {
        let db = TempDb::new("fresh");
        let c = open(&db.0).unwrap();
        assert_eq!(user_version(&c), CURRENT_VERSION);
        assert_eq!(
            tables(&c),
            ["done", "lists", "meta", "seeds", "shared_rows", "tags"]
        );
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

        // The ladder ran to v9 (the legacy row has every later column)…
        let (category, notes, routine): (String, String, String) = c
            .query_row(
                "SELECT category, notes, routine FROM habits WHERE id = 'h1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (category.as_str(), notes.as_str(), routine.as_str()),
            ("", "", "")
        );
        // …and v10 copied the rows into seeds with their `updated_at`.
        let (title, color, date, end, repeat, track, _) = seed_row(&c, "h1");
        assert_eq!(title, "run");
        assert_eq!(color, "purple"); // legacy 'primary'
        assert_eq!(date.as_deref(), Some("2026-01-01")); // anchored on created_at
        assert_eq!(end, None);
        assert_eq!(repeat, r#"{"n":1,"type":"every","unit":"day"}"#);
        assert_eq!(track, r#"{"kind":"check"}"#);
        let (title, _, date, _, repeat, track, _) = seed_row(&c, "e1");
        assert_eq!(
            (title.as_str(), date.as_deref()),
            ("dentist", Some("2026-01-03"))
        );
        assert_eq!(
            (repeat.as_str(), track.as_str()),
            (r#"{"type":"none"}"#, "")
        );
        assert_eq!(live(&c, "done", "seed_id"), ["h1"]);
        let at: i64 = c
            .query_row("SELECT updated_at FROM seeds WHERE id = 'h1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(at, 1);
        assert_eq!(
            read_meta(&c, crate::sync::META_PUSH_AT).as_deref(),
            Some("0")
        );
        assert_eq!(read_meta(&c, "legacy_import_done").as_deref(), Some("1"));

        // A second open is a no-op.
        drop(c);
        let c = open(&old.0).unwrap();
        assert_eq!(user_version(&c), CURRENT_VERSION);
        assert_same_shape(&c, &fresh);
        assert_eq!(live(&c, "seeds", "id"), ["e1", "h1"]);
    }

    /// The v5/v6 steps are `CREATE TABLE IF NOT EXISTS` and column adds; a
    /// database that already took the v2 and v4 steps must get only what it
    /// still lacks before v10 copies its rows.
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
        let (date, important, repeat): (Option<String>, i64, String) = c
            .query_row(
                "SELECT date, important, repeat FROM seeds WHERE id = 't1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (date.as_deref(), important, repeat.as_str()),
            (Some("2026-02-01"), 1, r#"{"type":"none"}"#)
        );
    }

    /// v10 on a current (v9) file: every kind of row lands in the seed tables
    /// with its dates, rules, colour and completions intact.
    #[test]
    fn a_version_10_database_gains_tag_keywords_and_re_pushes_its_tags() {
        let old = TempDb::new("v10");
        {
            let c = open(&old.0).unwrap();
            c.execute_batch(
                "ALTER TABLE tags DROP COLUMN keywords;
                 INSERT INTO tags (id, name, updated_at) VALUES ('t1', 'Gym', 1);
                 PRAGMA user_version = 10;",
            )
            .unwrap();
        }
        let fresh = TempDb::new("v10-fresh");
        let fresh = open(&fresh.0).unwrap();

        let c = open(&old.0).unwrap();
        assert_eq!(user_version(&c), CURRENT_VERSION);
        assert_same_shape(&c, &fresh);
        let (keywords, updated_at): (String, i64) = c
            .query_row(
                "SELECT keywords, updated_at FROM tags WHERE id = 't1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(keywords, "");
        assert!(updated_at > 1, "the tag is re-pushed with its new column");
    }

    #[test]
    fn a_version_9_database_migrates_rows_into_seeds() {
        let old = TempDb::new("v9");
        {
            let c = Connection::open(&old.0).unwrap();
            c.execute_batch(SCHEMA_V1).unwrap();
            c.execute_batch(V1_TO_V9).unwrap();
            c.execute_batch(SCHEMA_V5).unwrap();
            c.execute_batch(SCHEMA_V6).unwrap();
            c.execute_batch(
                "INSERT INTO categories (id, name, color_key, scopes, sort, created_at, updated_at)
                 VALUES ('c1', 'Work', '#3b82f6', 'calendar,tasks', 2, 1, 7);
                 INSERT INTO habits (id, name, color_key, kind, unit, target, schedule, created_at, reminder, due_date, time, category, important, notes, sort, routine, updated_at, deleted)
                 VALUES ('chore', 'bins', '#10b981', 'yesno', '', 1, '{\"type\":\"every\",\"n\":2,\"unit\":\"week\",\"fromDone\":true}', '2026-01-01', 1, NULL, '08:00', '', 0, 'blue bin', 3, 'morning', 11, 0),
                        ('gym', 'gym', '#ec4899', 'measurable', 'km', 5, '{\"type\":\"weekdays\",\"days\":[1,3,5]}', '2026-01-01', 0, '2026-01-05', NULL, '', 0, '', 1, '', 12, 0),
                        ('read', 'read', '#f59e0b', 'yesno', '', 1, '{\"type\":\"timesPer\",\"times\":3,\"per\":\"week\"}', '2026-01-01', 0, NULL, NULL, '', 0, '', 2, '', 13, 0),
                        ('milk', 'milk', '#a855f7', 'yesno', '', 1, '{\"type\":\"once\"}', '2026-01-01', 0, '2026-02-01', NULL, 'c1', 1, '', 0, '', 14, 0),
                        ('gone', 'gone', '#a855f7', 'yesno', '', 1, '{\"type\":\"once\"}', '2026-01-01', 0, NULL, NULL, '', 0, '', 0, '', 15, 1);
                 INSERT INTO habit_completions (habit_id, date, value, updated_at, deleted)
                 VALUES ('chore', '2026-01-10', 1, 16, 0), ('gym', '2026-01-05', 5, 17, 0), ('gym', '2026-01-07', 2, 18, 1);
                 INSERT INTO events (id, title, description, color_key, all_day, start_date, start_time, end_date, end_time, recurrence, reminders, category, updated_at)
                 VALUES ('standup', 'Standup', 'daily sync', '#a855f7', 0, '2026-01-05', '09:00', '2026-01-05', '09:15',
                         '{\"type\":\"weekly\",\"interval\":1,\"days\":[1,3],\"until\":\"2026-03-01\",\"exdates\":[\"2026-01-12\"]}', '[10,60]', 'c1', 21),
                        ('trip', 'Trip', '', '#a855f7', 1, '2026-02-10', '10:00', '2026-02-14', '11:00', '{\"type\":\"none\"}', '[]', '', 22);
                 INSERT INTO tasks (id, title, category, completed, date, updated_at)
                 VALUES ('old', 'old task', 'General', 1, '2025-12-01', 31);
                 INSERT INTO periods (id, name, color_key, start_date, end_date, notes, habit_ids, updated_at)
                 VALUES ('p1', 'Program', '#06b6d4', '2026-03-01', '2026-05-24', '12 weeks', '[\"gym\"]', 41);
                 INSERT INTO meta VALUES ('sync_push_at', '999');
                 PRAGMA user_version = 9;",
            )
            .unwrap();
        }
        let c = open(&old.0).unwrap();
        assert_eq!(user_version(&c), CURRENT_VERSION);
        assert_eq!(
            live(&c, "seeds", "id"),
            [
                "chore", "gym", "milk", "old", "p1", "read", "standup", "trip"
            ]
        );

        let (_, color, date, _, repeat, track, reminders) = seed_row(&c, "chore");
        assert_eq!(color, "green");
        assert_eq!(date.as_deref(), Some("2026-01-01"));
        assert_eq!(
            repeat,
            r#"{"fromDone":true,"n":2,"type":"every","unit":"week"}"#
        );
        assert_eq!(
            (track.as_str(), reminders.as_str()),
            (r#"{"kind":"check"}"#, "[0]")
        );
        let (notes, routine, sort, time): (String, String, i64, Option<String>) = c
            .query_row(
                "SELECT notes, routine, sort, time FROM seeds WHERE id = 'chore'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            (notes.as_str(), routine.as_str(), sort, time.as_deref()),
            ("blue bin", "morning", 3, Some("08:00"))
        );

        let (_, color, date, _, repeat, track, _) = seed_row(&c, "gym");
        assert_eq!(color, "pink");
        assert_eq!(date.as_deref(), Some("2026-01-05"));
        assert_eq!(
            repeat,
            r#"{"days":[1,3,5],"n":1,"type":"every","unit":"week"}"#
        );
        assert_eq!(track, r#"{"kind":"count","target":5.0,"unit":"km"}"#);

        let (_, _, _, _, repeat, _, _) = seed_row(&c, "read");
        assert_eq!(repeat, r#"{"per":"week","times":3,"type":"timesPer"}"#);

        // A once to-do in a category paints with the category's colour.
        let (_, color, date, _, repeat, _, _) = seed_row(&c, "milk");
        assert_eq!(
            (color.as_str(), date.as_deref(), repeat.as_str()),
            ("blue", Some("2026-02-01"), r#"{"type":"none"}"#)
        );
        let list: String = c
            .query_row("SELECT list FROM seeds WHERE id = 'milk'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(list, "c1");

        let (title, color, date, end, repeat, track, reminders) = seed_row(&c, "standup");
        assert_eq!(
            (title.as_str(), color.as_str(), date.as_deref(), end),
            ("Standup", "blue", Some("2026-01-05"), None)
        );
        assert_eq!(
            repeat,
            r#"{"days":[1,3],"exdates":["2026-01-12"],"n":1,"type":"every","unit":"week","until":"2026-03-01"}"#
        );
        assert_eq!((track.as_str(), reminders.as_str()), ("", "[10,60]"));
        let (notes, time, end_time): (String, Option<String>, Option<String>) = c
            .query_row(
                "SELECT notes, time, end_time FROM seeds WHERE id = 'standup'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (notes.as_str(), time.as_deref(), end_time.as_deref()),
            ("daily sync", Some("09:00"), Some("09:15"))
        );

        // All-day span: times dropped, end kept.
        let (_, _, date, end, _, _, _) = seed_row(&c, "trip");
        assert_eq!(
            (date.as_deref(), end.as_deref()),
            (Some("2026-02-10"), Some("2026-02-14"))
        );
        let time: Option<String> = c
            .query_row("SELECT time FROM seeds WHERE id = 'trip'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(time, None);

        let (title, _, date, _, _, track, _) = seed_row(&c, "old");
        assert_eq!(
            (title.as_str(), date.as_deref(), track.as_str()),
            ("old task", Some("2025-12-01"), r#"{"kind":"check"}"#)
        );
        // A period had no category, so it painted neutral: no colour of its own.
        let (_, color, date, end, _, track, _) = seed_row(&c, "p1");
        assert_eq!(
            (
                color.as_str(),
                date.as_deref(),
                end.as_deref(),
                track.as_str()
            ),
            ("", Some("2026-03-01"), Some("2026-05-24"), "")
        );

        // Completions: live ones follow their seeds, tombstoned ones don't.
        let done: Vec<(String, String, f64)> = c
            .prepare("SELECT seed_id, date, value FROM done WHERE deleted = 0 ORDER BY 1, 2")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(
            done,
            [
                ("chore".to_string(), "2026-01-10".to_string(), 1.0),
                ("gym".to_string(), "2026-01-05".to_string(), 5.0),
                ("old".to_string(), "2025-12-01".to_string(), 1.0),
            ]
        );

        // Categories became lists; timestamps survived; the push watermark
        // was reset so the whole set goes to the server once.
        let (name, sort, at): (String, i64, i64) = c
            .query_row(
                "SELECT name, sort, updated_at FROM lists WHERE id = 'c1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((name.as_str(), sort, at), ("Work", 2, 7));
        let at: i64 = c
            .query_row(
                "SELECT updated_at FROM seeds WHERE id = 'standup'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(at, 21);
        assert_eq!(
            read_meta(&c, crate::sync::META_PUSH_AT).as_deref(),
            Some("0")
        );
        // The legacy tables are still there, untouched.
        assert_eq!(live(&c, "habits", "id"), ["chore", "gym", "milk", "read"]);
    }

    #[test]
    fn save_and_load_round_trip_a_seed() {
        let c = conn();
        let seed = Seed {
            id: "s1".into(),
            title: "Water plants".into(),
            notes: "".into(),
            color: None,
            list: "".into(),
            tags: serde_json::json!(["tg"]),
            important: true,
            sort: 0,
            routine: "".into(),
            created_at: "2026-01-01".into(),
            date: Some("2026-01-04".into()),
            time: None,
            end_date: None,
            end_time: None,
            repeat: serde_json::json!({ "type": "every", "n": 3, "unit": "day", "fromDone": true }),
            track: serde_json::Value::Null,
            reminders: serde_json::json!([]),
            done: HashMap::new(),
        };
        upsert_seed(&c, &seed).unwrap();
        let (color, track, tags): (String, String, String) = c
            .query_row(
                "SELECT color, track, tags FROM seeds WHERE id = 's1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (color.as_str(), track.as_str(), tags.as_str()),
            ("", "", r#"["tg"]"#)
        );
        upsert_done(&c, "s1", "2026-01-04", 1.0).unwrap();
        upsert_done(&c, "s1", "2026-01-04", 0.0).unwrap();
        assert!(live(&c, "done", "seed_id").iter().all(|id| id != "s1"));
    }
}
