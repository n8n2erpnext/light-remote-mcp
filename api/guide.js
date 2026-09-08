module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'method_not_allowed' });
  return res.status(200).json({
    ok: true,
    project: 'gpt-vps-bridge',
    version: '0.3.0',
    purpose: 'ChatGPT-facing relay to the owner\'s VPS ARM operator plane',
    activePath: 'ChatGPT -> @Vercel -> gpt-vps-bridge -> MCP gateway -> encrypted host executor -> VPS ARM',
    upstream: 'https://mcp.dashboard.thaiduy.store',
    wall: 'https://wall.dashboard.thaiduy.store',
    readEndpoints: {
      ping: '/api/ping', identity: '/api/vps-identity', systemStatus: '/api/system-status', roots: '/api/workspace-roots',
      list: '/api/fs-list?root=n8n2erpnext&path=.&depth=2', read: '/api/fs-read?root=n8n2erpnext&path=README.md&startLine=1&maxLines=200',
      search: '/api/fs-search?root=n8n2erpnext&path=.&query=needle&maxResults=40', gitStatus: '/api/git-status?root=n8n2erpnext&repoPath=repo', gitDiff: '/api/git-diff?root=n8n2erpnext&repoPath=repo'
    },
    operatorEndpoints: {
      capabilities: '/api/operator?action=capabilities',
      exec: '/api/operator?action=exec&p=<base64url JSON>',
      job: '/api/operator?action=job&id=<job_id>',
      output: '/api/operator?action=output&id=<job_id>&stream=stdout&full=0&offset=0&limit=4194304'
    },
    execPayload: { script:'shell script', cwd:'/home/ubuntu', timeoutMs:600000, waitMs:7000, sessionId:'chatgpt', note:'intent' },
    rules: ['Prefer one logical exec_batch over many tiny calls.','Never put passwords, tokens, private keys, cookies or bearer tokens in URL payloads.','Use server-side secret references for secret-bearing work.','Wall is read-only observability only.'],
    security: { caller:'Vercel OIDC', envelope:'X25519 + HKDF-SHA256 + AES-256-GCM', replayProtection:true, executorUser:'ubuntu', publicGatewayPrivileged:false }
  });
};
