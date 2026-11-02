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

// The Owner cookie belongs to the system browser. Native gets ONLY a bounded
// anonymous local service probe, NEVER the /api/status body or any credential.
// This classifies a lock screen, NOT an authenticated Agent/device connection.
fn probe_loopback_wall() -> &'static str {
    use std::io::{Read, Write};
    use std::net::{SocketAddrV4, TcpStream, Ipv4Addr};
    use std::time::Duration;
    let addr = SocketAddrV4::new(Ipv4Addr::LOCALHOST, 5491);
    let Ok(mut socket) = TcpStream::connect_timeout(&addr.into(), Duration::from_millis(500)) else {
        return "unavailable";
    };
    if socket.set_read_timeout(Some(Duration::from_millis(500))).is_err() ||
        socket.set_write_timeout(Some(Duration::from_millis(500))).is_err() {
        return "unavailable";
    }
    if socket.write_all(b"GET /api/status HTTP/1.1\r\nHost: 127.0.0.1:5491\r\nConnection: close\r\nAccept: application/json\r\n\r\n").is_err() {
        return "unavailable";
    }
    // Strict upper bound: 4KiB, no redirects, no user URL, no reading tokens.
    let mut bytes = Vec::with_capacity(1024);
    if socket.take(4096).read_to_end(&mut bytes).is_err() {
        return "unavailable";
    }
    let Ok(reply) = std::str::from_utf8(&bytes) else { return "unavailable"; };
    let is_http = reply.starts_with("HTTP/1.1 ") || reply.starts_with("HTTP/1.0 ");
    if !is_http { return "unavailable"; }
    if (reply.starts_with("HTTP/1.1 401 ") || reply.starts_with("HTTP/1.0 401 ")) &&
        reply.contains("\"wall_auth_required\"") {
        return "owner_login_required";
    }
    // Auth-disabled test Wall is a separate state; NOT an Owner-verified Agent.
    if (reply.starts_with("HTTP/1.1 200 ") || reply.starts_with("HTTP/1.0 200 ")) &&
        reply.contains("\"ok\":true") {
        return "responding_unverified";
    }
    "unavailable"
}

#[tauri::command]
async fn probe_local_wall() -> &'static str {
    tauri::async_runtime::spawn_blocking(probe_loopback_wall)
        .await
        .unwrap_or("unavailable")
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_local_wall, probe_local_wall])
        .run(tauri::generate_context!())
        .expect("Light Remote V4 shell startup failed");
}
