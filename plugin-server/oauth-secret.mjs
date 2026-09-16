import fs from 'node:fs';
import { OAUTH_SECRET_FILE } from './config.mjs';

let cached = null;
export function oauthSecret() {
  if (cached) return cached;
  const text = fs.readFileSync(OAUTH_SECRET_FILE, 'utf8').trim();
  const raw = Buffer.from(text, 'base64url');
  if (raw.length < 32) throw new Error('plugin_oauth_secret_too_short');
  cached = raw;
  return cached;
}
