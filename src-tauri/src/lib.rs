mod account;
mod db;
mod sync;
mod token_store;

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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());
    // The QR scanner for cross-device sign-in. The crate is `#![cfg(mobile)]`
    // — it has no desktop half at all — and its capability lives in
    // `capabilities/mobile.json` for the same reason.
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    builder
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("albas.db"))?;
            app.manage(db::Db(Mutex::new(conn)));
            app.manage(account::AuthFlow::default());
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
            db::list_categories,
            db::save_category,
            db::delete_category,
            sync::sync_now,
            sync::sync_status,
            db::load_shared,
            account::app_signin_start,
            account::app_signin_poll,
            account::app_signin_cancel,
            account::app_signin_attach,
            account::app_session_claim,
            account::app_session_offer,
            account::account_register_password,
            account::account_login_password,
            account::sync_api,
            account::shares_list,
            account::shares_set,
            account::sync_sign_out,
            account::account_delete,
            account::account_export,
            fetch_ics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
