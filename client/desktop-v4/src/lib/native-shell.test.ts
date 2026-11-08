import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const conf = JSON.parse(readFileSync(path.resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8')) as {
  build: { devUrl: string; frontendDist: string };
  app: {
    withGlobalTauri: boolean;
    security: { capabilities: Array<{ identifier: string; windows: string[]; permissions: string[] }>; csp: string };
    windows: Array<{ label: string; minWidth: number; minHeight: number }>;
  };
  bundle: { active: boolean };
};
const rust = readFileSync(path.resolve(process.cwd(), 'src-tauri/src/main.rs'), 'utf8');

describe('Unified Tauri2 Desktop V4 native trust boundary', () => {
  it('grants only one fixed-url native opener command', () => {
    expect(conf.app.withGlobalTauri).toBe(false);
    expect(conf.app.security.capabilities).toEqual([{
      identifier: 'main-local-wall-browser',
      description: expect.any(String),
      windows: ['main'],
      permissions: ['allow-open-local-wall','allow-desktop-owner']
    }]);
    expect(conf.app.windows).toHaveLength(1);
    expect(conf.app.windows[0]?.label).toBe('main');
    expect(conf.bundle.active).toBe(true);
  });
  it('always opens the same-device Local Wall, regardless of GoldABV2 backend', () => {
    expect(rust).toContain('tauri::Builder::default()');
    expect(rust).toContain('tauri::generate_handler![open_local_wall, probe_local_wall]');
    expect(rust).toContain('endpoint_config::route("wallHome")');
    expect(rust).toContain('endpoint_config::route("wallStatus")');
    expect(rust).toContain('endpoint_config::local_socket("wall")');
    expect(rust).not.toContain('LR_V4_WALL_PROFILE');
    expect(rust).not.toContain('100.94.184.141');
    expect(rust).not.toContain('15591');
    expect(rust).not.toContain('goldabv2.light-remote.thaiduy.digital/mcp');

    expect(rust).toContain('endpoint_config::route("wallLogsPage")');
    expect(rust).toContain('unsupported_local_wall_view');
    for (const forbidden of [
      '.plugin(', 'tokio::process::Command',
      'tauri_plugin_shell', 'tauri_plugin_fs', 'cmd.exe', 'powershell.exe',
      'sh -c'
    ]) expect(rust).not.toContain(forbidden);
    const manifest = readFileSync(path.resolve(process.cwd(), 'src-tauri/build.rs'), 'utf8');
    const permission = readFileSync(path.resolve(process.cwd(), 'src-tauri/permissions/open-local-wall.toml'), 'utf8');
    expect(manifest).toContain('.commands(commands)');
    expect(manifest).toContain('CARGO_FEATURE_DESKTOP_OWNER_LOGIN');
    expect(manifest).toContain('"desktop_owner_begin"');
    expect(permission).toContain('commands.allow = ["open_local_wall", "probe_local_wall"]');
    const authPermission = readFileSync(path.resolve(process.cwd(),'src-tauri/permissions/desktop-owner.toml'),'utf8');
    expect(authPermission).toContain('"desktop_owner_begin"');
    expect(authPermission).toContain('"desktop_owner_logout"');
    const names=['desktop_native_action','desktop_link_ui_intent','desktop_owner_snapshot'];
    for(const command of names){
      expect(authPermission).toContain('"'+command+'"');
      expect(manifest).toContain('"'+command+'"');
    }
    expect(rust).toContain('unified_tray::desktop_native_action');
    expect(rust).toContain('unified_tray::desktop_link_ui_intent');
    expect(rust).toContain('#[cfg(not(feature = "desktop-owner-login"))]');
    expect(rust).toContain('tauri::generate_handler![open_local_wall, probe_local_wall]');
  });
  it('has native-only Owner refresh vault enabled in the unified app', () => {
    const cargo = readFileSync(path.resolve(process.cwd(), 'src-tauri/Cargo.toml'), 'utf8');
    const vault = readFileSync(path.resolve(process.cwd(), 'src-tauri/src/owner_vault.rs'), 'utf8');
    expect(cargo).toContain('default = ["desktop-owner-login"]');
    expect(cargo).toContain('desktop-owner-login = ["dep:keyring"');
    expect(cargo).toContain('"apple-native", "windows-native", "sync-secret-service"');
    expect(rust).toContain('#[cfg(feature = "desktop-owner-login")]');
    expect(vault).toContain('Entry::new(SERVICE, &authority_account()?)');
    expect(vault).toContain('endpoint_config::credential_authority()');
    expect(vault).toContain('Sha256::digest(authority.as_bytes())');
    expect(vault).toContain('.set_password(token)');
    expect(vault).toContain('.get_password()');
    expect(vault).toContain('.delete_credential()');
    expect(vault).not.toContain('localStorage');
    expect(vault).not.toContain('#[tauri::command]');
    expect(vault).not.toContain('light-remote.thaiduy.digital/mcp');
    const login = readFileSync(path.resolve(process.cwd(),'src-tauri/src/owner_login.rs'),'utf8');
    expect(login).toContain('TcpListener::bind("127.0.0.1:0")');
    expect(login).toContain('owner_vault::store_refresh(');
    expect(login).toContain('owner_vault::remove_refresh()');
    expect(login).toContain('desktop_owner_status');
    expect(login).toContain('desktop_owner_begin');
    expect(login).toContain('revalidate_owner(');
    expect(login).toContain('Policy::none()');
    expect(login).toContain('token_ok(');
    expect(login).not.toContain('https://goldabv2.light-remote.thaiduy.digital/mcp');
    const ownerClient=readFileSync(path.resolve(process.cwd(),'src/lib/native-owner.ts'),'utf8');
    expect(ownerClient).not.toContain('access_token');
    expect(ownerClient).not.toContain('refresh_token');
    expect(ownerClient).toContain("VITE_LR_V4_OWNER_LOGIN === '1'");
  });

  it('uses a local-only dev URL, bundled static files and restrictive CSP', () => {
    expect(conf.build.devUrl).toBe('http://127.0.0.1:5174');
    expect(conf.build.frontendDist).toBe('../dist');
    const csp = conf.app.security.csp;
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toContain('http:');
    expect(csp).not.toContain('https:');
  });
});
