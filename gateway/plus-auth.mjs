import crypto from 'node:crypto';

const REQUEST_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_PENDING = 24;

function safeId(value, pattern, name) {
  const text = String(value || '').trim();
  if (!pattern.test(text)) throw new Error(name);
  return text;
}
function digest(value) { return crypto.createHash('sha256').update(String(value)).digest(); }
function safeToken(value, expected) {
  const actual = digest(value);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function userCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function createPlusAuth(wallAuth) {
  const pending = new Map();
  const wallOrigin = String(process.env.WALL_PUBLIC_ORIGIN || 'https://wall.dashboard.thaiduy.store').replace(/\/$/, '');

  function prune(now = Date.now()) {
    for (const [id, row] of pending) if (row.expiresAt <= now || row.consumedAt) pending.delete(id);
    if (pending.size <= MAX_PENDING) return;
    for (const [id] of [...pending.entries()].sort((a,b)=>a[1].createdAt-b[1].createdAt).slice(0, pending.size - MAX_PENDING)) pending.delete(id);
  }

  function begin(req, res) {
    prune();
    const body = req.body || {};
    const agentId = safeId(body.agentId, /^[A-Za-z0-9._:-]{16,128}$/, 'invalid_plus_agent_id');
    const label = String(body.label || 'ChatGPT Plus').trim().slice(0, 120);
    const requestId = `pa_${crypto.randomBytes(18).toString('base64url')}`;
    const pollToken = crypto.randomBytes(32).toString('base64url');
    const row = { requestId, agentId, label, code:userCode(), pollHash:digest(pollToken), createdAt:Date.now(), expiresAt:Date.now()+REQUEST_TTL_MS, state:'pending', session:null };
    pending.set(requestId, row);
    return res.status(201).json({ ok:true, authorization:{ requestId, agentId, label, userCode:row.code, pollToken, expiresInSeconds:Math.floor(REQUEST_TTL_MS/1000), activationUrl:`${wallOrigin}/plus-authorize?id=${encodeURIComponent(requestId)}` } });
  }

  function poll(req, res) {
    prune();
    const body = req.body || {};
    const requestId = safeId(body.requestId, /^pa_[A-Za-z0-9_-]{20,80}$/, 'invalid_plus_request_id');
    const row = pending.get(requestId);
    if (!row || !safeToken(body.pollToken, row.pollHash)) return res.status(404).json({ ok:false, error:'plus_authorization_not_found' });
    if (row.state === 'denied') { row.consumedAt=Date.now(); return res.status(403).json({ ok:false, error:'plus_authorization_denied' }); }
    if (row.state !== 'approved' || !row.session) return res.status(202).json({ ok:true, status:'pending', expiresInSeconds:Math.max(0,Math.ceil((row.expiresAt-Date.now())/1000)) });
    row.consumedAt=Date.now();
    return res.status(200).json({ ok:true, status:'approved', session:row.session });
  }

  function list(_req, res) {
    prune();
    return res.json({ ok:true, pending:[...pending.values()].map(row=>({ requestId:row.requestId, agentId:row.agentId, label:row.label, userCode:row.code, state:row.state, createdAt:row.createdAt, expiresAt:row.expiresAt })) });
  }

  function approve(req, res) {
    prune();
    const row = pending.get(String(req.params.id || ''));
    if (!row) return res.status(404).json({ ok:false, error:'plus_authorization_not_found' });
    if (row.state !== 'pending') return res.status(409).json({ ok:false, error:`plus_authorization_${row.state}` });
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const token = wallAuth.signOAuthToken('plus', { sub:'owner', scope:'operator', agentId:row.agentId, iat:Date.now(), exp:expiresAt, jti:crypto.randomUUID() });
    row.state='approved'; row.session={ token, expiresAt, expiresInSeconds:Math.floor(SESSION_TTL_MS/1000), scope:'operator', agentId:row.agentId };
    return res.json({ ok:true, authorization:{ requestId:row.requestId, state:row.state, agentId:row.agentId, expiresAt } });
  }

  function deny(req, res) {
    prune();
    const row = pending.get(String(req.params.id || ''));
    if (!row) return res.status(404).json({ ok:false, error:'plus_authorization_not_found' });
    row.state='denied';
    return res.json({ ok:true, authorization:{ requestId:row.requestId, state:'denied' } });
  }

  function page(req, res) {
    prune();
    const id = String(req.query.id || '');
    const row = pending.get(id);
    if (!row) return res.status(404).type('html').send('<!doctype html><title>Light Remote MCP</title><p>Authorization request not found or expired.</p>');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    return res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize ChatGPT Plus</title><style>:root{color-scheme:dark;font-family:system-ui;background:#080a0c;color:#e5e7eb}body{margin:0;padding:24px}.card{max-width:620px;margin:auto;border:1px solid #29313a;border-radius:14px;padding:22px;background:#0b0f13}.muted{color:#8b98a8}.code{font:700 24px ui-monospace,monospace;letter-spacing:.12em;color:#ffcc00}button{padding:10px 14px;border-radius:8px;border:1px solid #394552;background:#111820;color:#e5e7eb;cursor:pointer;margin-right:8px}.yes{background:#ffcc00;color:#111;border-color:#ffcc00}</style></head><body><main class="card"><h1>Authorize Light Remote for ChatGPT Plus</h1><p class="muted">Approve only if this request matches the chat you started.</p><p>Request code</p><div class="code">${esc(row.code)}</div><p><b>Agent:</b> ${esc(row.agentId)}<br><b>Label:</b> ${esc(row.label)}</p><button class="yes" id="approve">Approve for 1 hour</button><button id="deny">Deny</button><p id="result" class="muted"></p></main><script>const id=${JSON.stringify(row.requestId)},out=document.getElementById('result');async function act(kind){const r=await fetch('/api/plus-authorizations/'+encodeURIComponent(id)+'/'+kind,{method:'POST'}),j=await r.json();out.textContent=r.ok?(kind==='approve'?'Approved. Return to ChatGPT.':'Denied.'):(j.error||'Request failed');}document.getElementById('approve').onclick=()=>act('approve');document.getElementById('deny').onclick=()=>act('deny');</script></body></html>`);
  }

  function requireSession(req, res, next) {
    const token = String(req.get('x-plus-session') || '');
    const value = token ? wallAuth.verifyOAuthToken('plus', token) : null;
    if (!value || value.scope !== 'operator' || value.exp <= Date.now()) return res.status(401).json({ ok:false, error:'plus_session_required' });
    req.plusIdentity=value;
    return next();
  }

  function requireAgent(req, res, next) {
    const expected=String(req.plusIdentity?.agentId || '');
    const actual=String(req.body?.agentId ?? req.query?.agentId ?? '');
    if (!expected || !actual || actual !== expected) return res.status(403).json({ ok:false, error:'plus_agent_mismatch' });
    return next();
  }

  return { begin, poll, list, approve, deny, page, requireSession, requireAgent };
}
