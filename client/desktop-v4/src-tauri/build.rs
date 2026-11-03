fn main() {
    // Explicit custom-command permission, never a blanket shell/fs plugin.
    let mut commands=vec!["open_local_wall","probe_local_wall"];
    // Cargo features are visible to the build script. No Owner native
    // commands are present in the unsigned UI-only pilot by default.
    if std::env::var_os("CARGO_FEATURE_DESKTOP_OWNER_LOGIN").is_some() {
        commands.extend([
            "desktop_owner_begin","desktop_owner_status",
            "desktop_owner_restore","desktop_owner_logout"
        ]);
    }
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&commands)
        )
    ).expect("Tauri V4 capability manifest generation failed");
}
