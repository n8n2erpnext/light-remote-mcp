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

describe('Tauri2 UI-only pilot trust boundary', () => {
  it('grants only one fixed-url native opener command', () => {
    expect(conf.app.withGlobalTauri).toBe(false);
    expect(conf.app.security.capabilities).toEqual([{
      identifier: 'main-local-wall-browser',
      description: expect.any(String),
      windows: ['main'],
      permissions: ['allow-open-local-wall']
    }]);
    expect(conf.app.windows).toHaveLength(1);
    expect(conf.app.windows[0]?.label).toBe('main');
    expect(conf.bundle.active).toBe(false);
  });
  it('allows the OS browser only for two hardcoded local Wall addresses', () => {
    expect(rust).toContain('tauri::Builder::default()');
    expect(rust).toContain('tauri::generate_handler![open_local_wall]');
    expect(rust).toContain('http://127.0.0.1:5491/');
    expect(rust).toContain('http://127.0.0.1:5491/settings#activityLogSettings');
    expect(rust).toContain('unsupported_local_wall_view');
    for (const forbidden of [
      '.plugin(', '.manage(', 'tokio::process::Command',
      'tauri_plugin_shell', 'tauri_plugin_fs', 'cmd.exe', 'powershell.exe',
      'sh -c'
    ]) expect(rust).not.toContain(forbidden);
    const manifest = readFileSync(path.resolve(process.cwd(), 'src-tauri/build.rs'), 'utf8');
    const permission = readFileSync(path.resolve(process.cwd(), 'src-tauri/permissions/open-local-wall.toml'), 'utf8');
    expect(manifest).toContain('.commands(&["open_local_wall"])');
    expect(permission).toContain('commands.allow = ["open_local_wall"]');
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
