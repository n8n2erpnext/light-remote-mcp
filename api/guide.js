module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'method_not_allowed' });
  return res.status(200).json({
    ok: true,
    project: 'gpt-vps-bridge',
    version: '0.4.0',
    purpose: 'ChatGPT-facing relay to the owner\'s VPS ARM operator plane',
    activePath: 'ChatGPT -> @Vercel -> gpt-vps-bridge -> MCP gateway -> encrypted host executor -> VPS ARM',
    upstream: 'https://mcp.dashboard.thaiduy.store',
    wall: 'https://wall.dashboard.thaiduy.store',
    recoveryDocs: ['CURRENT_STATE.md','AI_BRIDGE_GUIDE.md','SESSION_LANES_V0_4.md','BRIDGE_V0_3_ARCHITECTURE_PLAN.md','PORTABILITY.md'],
    readEndpoints: {
      ping: '/api/ping', identity: '/api/vps-identity', systemStatus: '/api/system-status', roots: '/api/workspace-roots',
      list: '/api/fs-list?root=n8n2erpnext&path=.&depth=2', read: '/api/fs-read?root=n8n2erpnext&path=README.md&startLine=1&maxLines=200',
      search: '/api/fs-search?root=n8n2erpnext&path=.&query=needle&maxResults=40', gitStatus: '/api/git-status?root=n8n2erpnext&repoPath=repo', gitDiff: '/api/git-diff?root=n8n2erpnext&repoPath=repo'
    },
    operatorEndpoints: {
      capabilities: '/api/operator?action=capabilities',
      sessionOpen: '/api/operator?action=session-open&p=<base64url {openId,label,workspace}>',
      sessionResume: '/api/operator?action=session-resume&sid=<session_id>',
      sessionClose: '/api/operator?action=session-close&sid=<session_id>',
      session: '/api/operator?action=session&sid=<session_id>',
      sessions: '/api/operator?action=sessions',
      sessionStats: '/api/operator?action=session-stats&hours=168',
      exec: '/api/operator?action=exec&p=<base64url JSON>',
      job: '/api/operator?action=job&id=<job_id>',
      output: '/api/operator?action=output&id=<job_id>&stream=stdout&full=0&offset=0&limit=4194304'
    },
    sessionPolicy: { idleGraceMinutes:30, activeJobHold:true, postJobGraceMinutes:30, maxActiveSessions:8, sessionHistoryDays:7, currentJobTimeoutHours:2 },
    execPayload: { operationId:'stable-id-for-one-logical-action', script:'shell script', cwd:'/home/ubuntu', timeoutMs:600000, waitMs:7000, sessionId:'server-issued-session-id', note:'intent' },
    rules: ['Generate a stable openId for one logical connection attempt; retrying the same session-open URL returns the same server-issued session instead of allocating another.','Open one logical session before work; resume the same ID after transient network loss.','A running job automatically holds its session even if transport disconnects; the 30-minute idle grace starts only after the last job finishes.','Prefer one logical exec_batch over many tiny calls.','Reuse the same operationId only when retrying the exact same logical operation; changed payloads under an existing ID are rejected.','Never put passwords, tokens, private keys, cookies or bearer tokens in URL payloads.','Use server-side secret references for secret-bearing work.','Wall is read-only observability only.'],
    security: { caller:'Vercel OIDC', envelope:'X25519 + HKDF-SHA256 + AES-256-GCM', replayProtection:true, semanticIdempotency:true, wallAuth:'NetBird PIN', executorUser:'ubuntu', publicGatewayPrivileged:false }
  });
};
