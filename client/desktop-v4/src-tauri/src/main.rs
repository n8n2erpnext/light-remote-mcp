//! Native Desktop V4 **shell-only** proof.
//!
//! Intentionally no invoke_handler, no native plugins, no OS shell/FS/process,
//! no second Agent, no Local Wall server or Owner bridge. The bundled webview
//! cannot obtain any privileged native capability by navigating UI routes.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Light Remote V4 shell startup failed");
}
