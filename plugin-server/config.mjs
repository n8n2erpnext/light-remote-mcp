import os from 'node:os';
import path from 'node:path';

export const PUBLIC_ORIGIN = String(process.env.LIGHT_REMOTE_PLUGIN_ORIGIN || 'https://plugin.thaiduy.digital').replace(/\/$/, '');
const loopbackHttpAllowed = process.env.LIGHT_REMOTE_PLUGIN_ALLOW_HTTP_LOOPBACK === '1' && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(PUBLIC_ORIGIN);
if (!PUBLIC_ORIGIN.startsWith('https://') && !loopbackHttpAllowed) throw new Error('plugin_origin_must_be_https');

export const MCP_RESOURCE = `${PUBLIC_ORIGIN}/mcp`;
export const PUBLIC_HOST = String(process.env.LIGHT_REMOTE_PLUGIN_HOST || '127.0.0.1');
export const PUBLIC_PORT = Math.max(1024, Math.min(Number(process.env.LIGHT_REMOTE_PLUGIN_PORT) || 5495, 65535));
const originHost = new URL(PUBLIC_ORIGIN).host;
export const PUBLIC_ALLOWED_HOSTS = [...new Set([originHost, 'localhost', '127.0.0.1', `${PUBLIC_HOST}:${PUBLIC_PORT}`, ...String(process.env.LIGHT_REMOTE_PLUGIN_ALLOWED_HOSTS || '').split(',').map(x=>x.trim()).filter(Boolean)])];
export const INTERNAL_HOST = String(process.env.LIGHT_REMOTE_PLUGIN_INTERNAL_HOST || '127.0.0.1');
export const INTERNAL_PORT = Math.max(1024, Math.min(Number(process.env.LIGHT_REMOTE_PLUGIN_INTERNAL_PORT) || 5496, 65535));
export const INTERNAL_ALLOWED_IP = String(process.env.LIGHT_REMOTE_PLUGIN_INTERNAL_ALLOWED_IP || '127.0.0.1');
export const OPERATOR_SOCKET = String(process.env.OPERATOR_SOCKET || path.join(os.homedir(), '.local/run/gpt-vps-operator/operator.sock'));
export const OAUTH_SECRET_FILE = String(process.env.LIGHT_REMOTE_PLUGIN_OAUTH_SECRET_FILE || path.join(os.homedir(), '.config/light-remote/plugin-oauth-secret'));
export const OPENAI_CHALLENGE_FILE = String(process.env.LIGHT_REMOTE_OPENAI_CHALLENGE_FILE || path.join(os.homedir(), '.config/light-remote/openai-apps-challenge'));
export const POLICY_BASE = `${PUBLIC_ORIGIN}`;
