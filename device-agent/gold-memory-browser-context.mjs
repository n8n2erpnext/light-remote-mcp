import { createHash, randomUUID } from 'node:crypto';
import { prepareGoldMemoryV2 } from './gold-memory-scope.mjs';

const maxBytes = 512 * 1024;
const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const problem = (code, status) => Object.assign(new Error(code), { status });
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');

function prepare(db) {
  prepareGoldMemoryV2(db);
  db.exec(`CREATE TABLE IF NOT EXISTS lm_browser_context (
    scope_id TEXT NOT NULL REFERENCES lm_scopes(scope_id),
    conversation_url TEXT NOT NULL,
    provider TEXT NOT NULL,
    home_epoch INTEGER NOT NULL,
    watch_id TEXT,
    body TEXT,
    sha256 TEXT,
    saved_at INTEGER,
    PRIMARY KEY (scope_id, conversation_url)
  )`);
}

function findScope(db, { accountId, scopeId }) {
  if (typeof scopeId !== 'string' || !id.test(scopeId)) throw problem('gold_memory_browser_scope_invalid', 400);
  const scope = db.prepare('SELECT status,home_device_id,home_epoch FROM lm_scopes WHERE scope_id=? AND account_id=?').get(scopeId, accountId);
  if (!scope) throw problem('gold_scope_not_found', 404);
  return scope;
}

function conversation(value) {
  if (typeof value !== 'string' || value.length > 512) throw problem('gold_memory_browser_conversation_invalid', 400);
  let url;
  try { url = new URL(value); } catch { throw problem('gold_memory_browser_conversation_invalid', 400); }
  const provider = url.origin === 'https://chatgpt.com' && /^\/(?:g\/[\w-]+\/)?c\/[\w-]{8,100}$/.test(url.pathname) ? 'chatgpt'
    : url.origin === 'https://claude.ai' && /^\/chat\/[\w-]{8,100}$/.test(url.pathname) ? 'claude' : null;
  if (!provider || value !== url.origin + url.pathname) throw problem('gold_memory_browser_conversation_invalid', 400);
  return { provider, url:value };
}

export function updateBrowserContext(db, identity, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw problem('gold_memory_browser_action_invalid', 400);
  const { action, scopeId, watchId, ownerConfirmed, text, sha256 } = input;
  if (input.accountId !== identity.accountId || input.deviceId !== identity.deviceId) {
    throw problem('gold_memory_browser_identity_changed', 403);
  }
  const target = conversation(input.conversationUrl);
  prepare(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    const scope = findScope(db, { ...identity, scopeId });
    if (scope.home_device_id !== identity.deviceId || scope.status !== 'active') {
      throw problem('gold_memory_browser_home_inactive', 403);
    }
    const identityParams = [scopeId, target.url, scope.home_epoch];
    let result;
    if (action === 'start') {
      if (ownerConfirmed !== true) throw problem('gold_memory_browser_confirmation_required', 403);
      const next = randomUUID();
      db.prepare(`INSERT INTO lm_browser_context(scope_id,conversation_url,provider,home_epoch,watch_id)
        VALUES(?,?,?,?,?) ON CONFLICT(scope_id,conversation_url) DO UPDATE SET
        watch_id=excluded.watch_id,home_epoch=excluded.home_epoch,
        body=CASE WHEN home_epoch=excluded.home_epoch THEN body ELSE NULL END,
        sha256=CASE WHEN home_epoch=excluded.home_epoch THEN sha256 ELSE NULL END,
        saved_at=CASE WHEN home_epoch=excluded.home_epoch THEN saved_at ELSE NULL END`)
        .run(scopeId, target.url, target.provider, scope.home_epoch, next);
      result = { watchId:next };
    } else {
      if (!['save','stop'].includes(action) || typeof watchId !== 'string' || !id.test(watchId)) {
        throw problem('gold_memory_browser_action_invalid', 400);
      }
      const filter = 'scope_id=? AND conversation_url=? AND home_epoch=? AND watch_id=?';
      const params = [...identityParams, watchId];
      if (action === 'stop') {
        db.prepare('UPDATE lm_browser_context SET watch_id=NULL WHERE '+filter).run(...params);
        result = { stopped:true };
      } else {
        if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text,'utf8') > maxBytes || digest(text) !== sha256) {
          throw problem('gold_memory_browser_snapshot_invalid', 400);
        }
        const current = db.prepare('SELECT sha256,saved_at FROM lm_browser_context WHERE '+filter).get(...params);
        if (!current) throw problem('gold_memory_browser_watch_stopped', 409);
        const changed = current.sha256 !== sha256;
        const savedAt = changed ? Date.now() : current.saved_at;
        if (changed) db.prepare('UPDATE lm_browser_context SET body=?,sha256=?,saved_at=? WHERE '+filter).run(text, sha256, savedAt, ...params);
        result = { savedAt, sha256, changed };
      }
    }
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function readBrowserContext(db, { accountId, scopeId }) {
  prepare(db);
  const scope = findScope(db, { accountId, scopeId });
  const row = db.prepare(`SELECT conversation_url,provider,body,sha256,saved_at FROM lm_browser_context
    WHERE scope_id=? AND home_epoch=? AND body IS NOT NULL ORDER BY saved_at DESC,conversation_url LIMIT 1`)
    .get(scopeId, scope.home_epoch);
  if (!row) return { scopeId, available:false };
  if (digest(row.body) !== row.sha256) throw problem('gold_memory_browser_context_digest_invalid', 409);
  return { scopeId, available:true, conversationUrl:row.conversation_url, provider:row.provider,
    title:row.provider === 'chatgpt' ? 'ChatGPT browser context' : 'Claude browser context',
    text:row.body, sha256:row.sha256, bytes:Buffer.byteLength(row.body,'utf8'), savedAt:row.saved_at,
    integrity:'browser_context_sha256_verified' };
}
