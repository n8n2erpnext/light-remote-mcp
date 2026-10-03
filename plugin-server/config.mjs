import os from 'node:os';
import path from 'node:path';

export const PUBLIC_ORIGIN = String(process.env.LIGHT_REMOTE_PLUGIN_ORIGIN || 'https://light-remote.thaiduy.digital').replace(/\/$/, '');
const loopbackHttp = process.env.LIGHT_REMOTE_PLUGIN_ALLOW_HTTP_LOOPBACK === '1' &&
  /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(PUBLIC_ORIGIN);
if (!PUBLIC_ORIGIN.startsWith('https://') && !loopbackHttp) throw new Error('plugin_origin_must_be_https');

export const MCP_RESOURCE = `${PUBLIC_ORIGIN}/mcp`;
export const PUBLIC_HOST = String(process.env.LIGHT_REMOTE_PLUGIN_HOST || '127.0.0.1');
export const PUBLIC_PORT = Math.max(1024, Math.min(Number(process.env.LIGHT_REMOTE_PLUGIN_PORT) || 5495, 65535));
export const PUBLIC_ALLOWED_HOSTS = [...new Set([
  new URL(PUBLIC_ORIGIN).host,
  'localhost',
  '127.0.0.1',
  `${PUBLIC_HOST}:${PUBLIC_PORT}`,
  ...String(process.env.LIGHT_REMOTE_PLUGIN_ALLOWED_HOSTS || '').split(',').map(v => v.trim()).filter(Boolean)
])];

export const OPERATOR_SOCKET = String(process.env.OPERATOR_SOCKET || '/run/gpt-vps-operator/operator.sock');
export const OAUTH_SECRET_FILE = String(process.env.LIGHT_REMOTE_PLUGIN_OAUTH_SECRET_FILE || path.join(os.homedir(), '.config/light-remote/plugin-oauth-secret'));
export const OPENAI_CHALLENGE_FILE = String(process.env.LIGHT_REMOTE_OPENAI_CHALLENGE_FILE || path.join(os.homedir(), '.config/light-remote/openai-apps-challenge'));
export const VERSION = String(process.env.LIGHT_REMOTE_VERSION || '0.9.0-rc.30');
export const MAX_PROXY_BODY = Math.max(1024 * 1024, Math.min(Number(process.env.LIGHT_REMOTE_PLUGIN_MAX_PROXY_BODY) || 12 * 1024 * 1024, 64 * 1024 * 1024));
