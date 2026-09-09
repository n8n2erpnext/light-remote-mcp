# GPT VPS Bridge — Current State

Updated: 2026-09-09
Version: v0.5 production candidate

## Active path
`ChatGPT -> @Vercel -> gpt-vps-bridge.vercel.app -> ARM hub/MCP Gateway -> Unix socket -> gpt-vps-operator (ubuntu)`

## Production facts
- v0.3 operator baseline remains accepted: encrypted, authenticated, idempotent host execution as `ubuntu` with sudo/Docker/LXD/Git/build/test capability.
- v0.4 added resilient managed session leases: 30-minute idle grace, automatic HOLD while jobs run, fresh 30-minute post-job reconnect grace, and disk-backed usage reconstruction.
- v0.5 adds explicit one-agent/one-live-session ownership. Each agent creates a stable random `agentId`; the server issues one `sessionId`. A different `agentId` cannot resume, execute, read job state, or retrieve output from that lane (`409 session_owner_mismatch`).
- Re-opening while the same agent already has a live lane returns that same session instead of consuming another slot.
- Session-aware read-only tool calls (`sid` + `aid`) also renew the lease; discovery calls may remain untracked before a session is opened.
- Default live-session ceiling is 5, matching the current 1–5 agent operating target. Expired/closed sessions do not consume live capacity.
- No repo/file/service locking is imposed. Concurrent agents coordinate using normal Git branch/worktree/clean-tree discipline.
- Wall is NetBird-PIN protected and read-only. It exposes an ALL view plus one tab per live session, with node/session/agent metadata, state, stats, jobs, command and output.
- Current execution node is `nodeId=arm`. Hub metadata is now carried through sessions/jobs/logs to prepare future ARM -> AMD/HomeLab routing without changing the ChatGPT-facing Vercel URL.
- Actual remote-node transport is not implemented yet; current v0.5 is intentionally single-node ARM until a second executor exists.
- Authoritative audit remains `/var/log/gpt-vps-operator/operations.jsonl` with 50 MiB x 3 rotation; wall memory remains bounded at 16 MiB / 5000 events.

## Session state machine
`active -> hold(active job) -> active(post-job grace) -> expired`

Every real session-aware call refreshes `lastSeenAt`. Running jobs suspend expiry. Transport loss never owns process lifetime; the same agent resumes its lane. A different agent is rejected rather than silently sharing it.

## Recovery order
Fetch `/api/guide`, then read `AI_BRIDGE_GUIDE.md`, this file, `SESSION_OWNERSHIP_V0_5.md`, `HUB_TOPOLOGY_V0_5.md`, `SESSION_LANES_V0_4.md`, and `BRIDGE_V0_3_ARCHITECTURE_PLAN.md`. RDC remains rescue-only during soak.
