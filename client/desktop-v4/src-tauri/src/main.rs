//! Desktop V4 native shell. The ONLY IPC here opens the already-installed
//! device's Local Wall in the system browser. Never boots an Agent, reads
//! Owner credentials, changes a grant or takes a user-supplied URL/path.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn open_local_wall(view: &str) -> Result<(), String> {
    const WALL: &str = "http://127.0.0.1:5491/";
    const LOGS: &str = "http://127.0.0.1:5491/settings#activityLogSettings";
    let url = match view {
        "home" => WALL,
        "logs" => LOGS,
        _ => return Err("unsupported_local_wall_view".into()),
    };
    // No shell interpreter or untrusted arguments. Only the two literal local
    // URLs above can be passed to the platform's default-browser launcher.
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32.exe")
        .arg("url.dll,FileProtocolHandler").arg(url).spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(url).spawn();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(url).spawn();
    result.map(|_| ()).map_err(|_| "system_browser_unavailable".to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_local_wall])
        .run(tauri::generate_context!())
        .expect("Light Remote V4 shell startup failed");
}
