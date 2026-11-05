//! Desktop V4 native shell. The ONLY IPC here opens the already-installed
//! device's Local Wall in the system browser. Never boots an Agent, reads
//! Owner credentials, changes a grant or takes a user-supplied URL/path.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Candidate native-only Owner refresh vault is never exposed by Tauri IPC.
// All credential use will stay in Rust, never React JS or Local Wall cookies.
#[cfg(feature = "desktop-owner-login")]
mod owner_vault;
#[cfg(feature = "desktop-owner-login")]
mod owner_login;
#[cfg(feature = "desktop-owner-login")]
mod owner_wall_ticket;

// Every desktop host opens its OWN device-local Wall. GoldABV2 is the
// cloud Owner/Operator backend, never an alternate Wall destination.
// A Linux LXD NetBird NAT access URL is only external QA, never App Wall.
fn exact_wall_view(view: &str) -> Result<&'static str, String> {
    match view {
        "home" => Ok("http://127.0.0.1:5491/"),
        "logs" => Ok("http://127.0.0.1:5491/settings#activityLogSettings"),
        _ => Err("unsupported_local_wall_view".into()),
    }
}

#[tauri::command]
fn open_local_wall(view: &str) -> Result<(), String> {
    let url = exact_wall_view(view)?;
    // Exact literal URL only. No Owner credentials or MCP endpoint.
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
fn probe_wall_presence() -> &'static str {
    use std::io::{Read, Write};
    use std::net::{SocketAddrV4, TcpStream, Ipv4Addr};
    use std::time::Duration;
    let addr=SocketAddrV4::new(Ipv4Addr::LOCALHOST, 5491);
    let request=b"GET /api/status HTTP/1.1\r\nHost: 127.0.0.1:5491\r\nConnection: close\r\nAccept: application/json\r\n\r\n";
    let Ok(mut socket) = TcpStream::connect_timeout(&addr.into(), Duration::from_millis(500)) else {
        return "unavailable";
    };
    if socket.set_read_timeout(Some(Duration::from_millis(500))).is_err() ||
        socket.set_write_timeout(Some(Duration::from_millis(500))).is_err() {
        return "unavailable";
    }
    if socket.write_all(request).is_err() {
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
    tauri::async_runtime::spawn_blocking(probe_wall_presence)
        .await
        .unwrap_or("unavailable")
}

// UI-only Pilot retains exactly two commands. No login token, browser
// callback, Owner authorization or vault use is compiled into this binary.
#[cfg(not(feature = "desktop-owner-login"))]
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_local_wall, probe_local_wall])
        .run(tauri::generate_context!())
        .expect("Light Remote V4 shell startup failed");
}

// Opt-in isolated Owner Login candidate. Native commands return ONLY a
// sanitized account/phase projection; credentials remain Rust+OS Keyring.
#[cfg(feature = "desktop-owner-login")]
fn main() {
    tauri::Builder::default()
        .manage(owner_login::OwnerRuntime::default())
        .invoke_handler(tauri::generate_handler![
            open_local_wall, probe_local_wall,
            owner_login::desktop_owner_begin, owner_login::desktop_owner_status,
            owner_login::desktop_owner_restore, owner_login::desktop_owner_logout,
            owner_login::desktop_owner_wall_sso_approve
        ])
        .run(tauri::generate_context!())
        .expect("Light Remote V4 Owner Login candidate startup failed");
}
