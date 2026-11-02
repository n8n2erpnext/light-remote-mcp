fn main() {
    // Explicit custom-command permission, never a blanket shell/fs plugin.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["open_local_wall", "probe_local_wall"])
        )
    ).expect("Tauri V4 capability manifest generation failed");
}
