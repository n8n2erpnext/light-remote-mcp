// Static slices satisfy Tauri AppManifest lifetime requirements; no runtime
// command reflection and no dynamic permissions from user input.
static UI_ONLY: &[&str] = &["open_local_wall","probe_local_wall"];
static OWNER_CANDIDATE: &[&str] = &[
    "open_local_wall","probe_local_wall",
    "desktop_owner_begin","desktop_owner_status",
    "desktop_owner_restore","desktop_owner_logout"
];
fn main() {
    let commands: &'static [&'static str] =
        if std::env::var_os("CARGO_FEATURE_DESKTOP_OWNER_LOGIN").is_some() {
            OWNER_CANDIDATE
        } else { UI_ONLY };
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(commands)
        )
    ).expect("Tauri V4 capability manifest generation failed");
}
