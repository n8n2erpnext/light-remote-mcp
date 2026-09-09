module.exports = function handler(req, res) {
  res.setHeader('Cache-Control','no-store'); res.setHeader('X-Robots-Tag','noindex,nofollow,noarchive');
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'method_not_allowed'});
  return res.status(200).json({ok:true,project:'gpt-vps-bridge',version:'0.5.0',purpose:'ChatGPT-facing relay to the owner VPS operator hub',
    activePath:'ChatGPT -> @Vercel -> ARM hub -> selected node executor',upstream:'https://mcp.dashboard.thaiduy.store',wall:'https://wall.dashboard.thaiduy.store',
    recoveryDocs:['CURRENT_STATE.md','AI_BRIDGE_GUIDE.md','SESSION_LANES_V0_4.md','HUB_TOPOLOGY_V0_5.md','BRIDGE_V0_3_ARCHITECTURE_PLAN.md','PORTABILITY.md'],
    sessionStart:{agentId:'generate one stable random agent id for this ChatGPT agent/chat, e.g. a_<uuid>',openId:'stable id for one open attempt',open:'/api/operator?action=session-open&p=<base64url {agentId,openId,label,workspace}>'},
    operatorEndpoints:{capabilities:'/api/operator?action=capabilities',sessionResume:'/api/operator?action=session-resume&sid=<sid>&aid=<agentId>',sessionClose:'/api/operator?action=session-close&sid=<sid>&aid=<agentId>',session:'/api/operator?action=session&sid=<sid>&aid=<agentId>',sessions:'/api/operator?action=sessions',sessionStats:'/api/operator?action=session-stats&hours=168',exec:'/api/operator?action=exec&p=<base64url {operationId,script,cwd,timeoutMs,waitMs,sessionId,agentId,note}>',job:'/api/operator?action=job&id=<job>&aid=<agentId>',output:'/api/operator?action=output&id=<job>&aid=<agentId>&stream=stdout&full=0&offset=0&limit=4194304'},
    readRule:'After opening a session, append sid=<sessionId>&aid=<agentId> to read-only endpoints so every real tool call renews that lane. Discovery calls may omit session context.',
    sessionPolicy:{oneAgentOneLiveSession:true,ownerMismatch:'409 session_owner_mismatch',idleGraceMinutes:30,activeJobHold:true,postJobGraceMinutes:30,maxActiveSessions:5,sessionHistoryDays:7,currentJobTimeoutHours:2},
    nodeModel:{currentHub:'arm',currentNodes:['arm'],future:'AMD/HomeLab executors register to ARM hub; Vercel remains connected only to ARM; wall aggregates all node/session lanes.'},
    rules:['One agent owns exactly one live session. A second agentId cannot resume/execute/read job output from that session.','The same agent opening again while its lane is live gets the same session instead of consuming another slot.','Every session-aware tool call renews the 30-minute lease; running jobs suspend expiry until the last job finishes.','Use Git/worktree discipline for repo concurrency; the operator adds no repo/file locks.','Never put passwords/tokens/private keys/cookies in URL payloads.','Prefer one logical exec_batch over many tiny calls.'],
    security:{caller:'Vercel OIDC',envelope:'X25519 + HKDF-SHA256 + AES-256-GCM',replayProtection:true,semanticIdempotency:true,wallAuth:'NetBird PIN',executorUser:'ubuntu'}
  });
};
