module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'method_not_allowed' });

  return res.status(200).json({
    ok: true,
    project: 'gpt-vps-bridge',
    purpose: 'ChatGPT-facing relay to the owner\'s VPS ARM MCP',
    startHere: 'A new session should fetch this endpoint first, then use the endpoint map below.',
    activePath: 'ChatGPT -> @Vercel -> gpt-vps-bridge.vercel.app -> mcp.dashboard.thaiduy.store -> VPS ARM',
    upstream: 'https://mcp.dashboard.thaiduy.store/mcp',
    wall: 'https://wall.dashboard.thaiduy.store',
    endpoints: {
      ping: '/api/ping',
      identity: '/api/vps-identity',
      systemStatus: '/api/system-status',
      roots: '/api/workspace-roots',
      list: '/api/fs-list?root=n8n2erpnext&path=.&depth=2',
      read: '/api/fs-read?root=n8n2erpnext&path=README.md&startLine=1&maxLines=200',
      search: '/api/fs-search?root=n8n2erpnext&path=.&query=needle&maxResults=40',
      gitStatus: '/api/git-status?root=n8n2erpnext&repoPath=repo',
      gitDiff: '/api/git-diff?root=n8n2erpnext&repoPath=repo'
    },
    notes: [
      'Use @Vercel web_fetch_vercel_url against the production URL.',
      'Read-only endpoints are intentionally cheap and stateless.',
      'For future privileged operations, prefer one grouped/batch request rather than many tiny round-trips.',
      'Do not send secrets in query strings; use authenticated server-side channels for secret-bearing actions.',
      'The web wall is observability only and must not become an execution endpoint.'
    ],
    security: {
      auth: 'Vercel OIDC',
      audience: 'https://mcp.dashboard.thaiduy.store',
      project: 'gpt-vps-bridge',
      environment: 'production'
    }
  });
};
