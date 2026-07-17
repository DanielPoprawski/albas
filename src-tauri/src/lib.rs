mod db;

use std::sync::Mutex;
use tauri::Manager;

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
