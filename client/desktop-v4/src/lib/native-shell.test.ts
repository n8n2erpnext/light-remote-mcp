import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const conf = JSON.parse(readFileSync(path.resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8')) as {
  build: { devUrl: string; frontendDist: string };
  app: {
    withGlobalTauri: boolean;
    security: { capabilities: string[]; csp: string };
    windows: Array<{ label: string; minWidth: number; minHeight: number }>;
  };
  bundle: { active: boolean };
};
const rust = readFileSync(path.resolve(process.cwd(), 'src-tauri/src/main.rs'), 'utf8');

describe('Tauri2 UI-only pilot trust boundary', () => {
  it('grants the webview zero Tauri API permissions', () => {
    expect(conf.app.withGlobalTauri).toBe(false);
    expect(conf.app.security.capabilities).toEqual([]);
    expect(conf.app.windows).toHaveLength(1);
    expect(conf.app.windows[0]?.label).toBe('main');
    expect(conf.bundle.active).toBe(false);
  });
  it('runs no native commands, plugins, shell or background Agent', () => {
    expect(rust).toContain('tauri::Builder::default()');
    for (const forbidden of [
      '.invoke_handler(', '.plugin(', '.manage(', 'std::process::Command::new(',
      'tokio::process::Command', 'tauri_plugin_shell', 'tauri_plugin_fs'
    ]) expect(rust).not.toContain(forbidden);
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
