mod db;
mod sync;
mod wyze;

use std::sync::Mutex;
use tauri::Manager;

/// Fetch an iCalendar feed (e.g. Google Calendar's "secret address in iCal
/// format") server-side, since the WebView's CORS policy blocks it.
#[tauri::command]
async fn fetch_ics(url: String) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("URL must start with https://".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        ureq::get(&url)
            .timeout(std::time::Duration::from_secs(30))
            .call()
            .map_err(|e| e.to_string())?
            .into_string()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("albas.db"))?;
            app.manage(db::Db(Mutex::new(conn)));
            app.manage(wyze::WyzeSession::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::load_state,
            db::save_task,
            db::delete_task,
            db::save_habit,
            db::delete_habit,
            db::set_completion,
            db::save_event,
            db::delete_event,
            db::save_period,
            db::delete_period,
            db::import_legacy,
            db::set_setting,
            db::save_weight,
            db::delete_weight,
            wyze::wyze_save_credentials,
            wyze::wyze_clear_credentials,
            wyze::wyze_status,
            wyze::wyze_sync,
            sync::sync_now,
            sync::sync_status,
            fetch_ics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
