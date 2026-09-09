# GPT VPS Bridge

Portable private operator bridge and ARM control hub.

`ChatGPT -> @Vercel -> Vercel Function -> ARM MCP Gateway -> selected Host Executor -> target node`

## Start here
A fresh ChatGPT agent should fetch `https://gpt-vps-bridge.vercel.app/api/guide` and follow the returned session rules. Recovery docs: `CURRENT_STATE.md`, `AI_BRIDGE_GUIDE.md`, `SESSION_OWNERSHIP_V0_5.md`, `HUB_TOPOLOGY_V0_5.md`, `SESSION_LANES_V0_4.md`, `PRODUCT_PLATFORM_PLAN_V0_6_TO_PUBLIC_PLUGIN.md`, `DEVICE_PRESENCE_V0_6.md`, `PORTABILITY.md`.

## Session-first operation (v0.5)
Each agent generates one opaque random `agentId` and opens one server-issued session. One agent owns one live lane; a second agent cannot attach to that session (`409 session_owner_mismatch`). Re-opening while the same agent already has a live lane returns the same session rather than allocating another.

Idle lease is 30 minutes. Any session-aware tool call renews it. Running jobs put the lane in HOLD so long builds survive Vercel/network loss; when the final job finishes, a fresh 30-minute reconnect grace begins. Default live ceiling is 5 sessions. There are intentionally no repo/file/service locks: use normal Git/worktree discipline.

## Read endpoints
v0.5.1 requires an authenticated bridge caller for every Vercel read/operator proxy request. After caller authentication and session open, append `sid=<sessionId>&aid=<agentId>` so reads renew and audit the correct session:
- `GET /api/ping`
- `GET /api/vps-identity`
- `GET /api/system-status`
- `GET /api/workspace-roots`
- `GET /api/fs-list`
- `GET /api/fs-read`
- `GET /api/fs-search`
- `GET /api/git-status`
- `GET /api/git-diff`

## Operator transport
All operator actions share one Vercel Function to stay below the 12-function project ceiling; `deploy/scripts/selftest-vercel-function-budget.mjs` guards that budget in regression. Open with `action=session-open&p=<base64url {agentId,openId,label,workspace}>`; exec payloads include `agentId`, `sessionId`, stable `operationId`, `cwd`, `script`, timeout/wait and note. Resume/get/close/job/output carry `aid=<agentId>`.

Grouped shell batches are preferred for build/test/Git/Docker/LXD/system work. Reuse an `operationId` only to retry the exact same logical action; changed payloads under the same ID are rejected. v0.6 adds structured POST/body transport for operator payloads and keeps GET/query/base64 only as a legacy small-call compatibility lane with a strict size ceiling. RDC remains the rescue lane for self-disruptive deploy/rebuild work.

## Security
v0.5.1 separates two identities that must not be conflated: the internet caller must authenticate to the Vercel bridge, then Vercel OIDC authenticates that bridge to ARM. The outer bridge boundary requires `Authorization: Bearer` backed by `VPS_BRIDGE_CALLER_SECRET` and fails closed if the secret is unset. Privileged payloads still use X25519 + HKDF-SHA256 + AES-256-GCM, short expiry, replay rejection and semantic idempotency. Never place caller credentials/tokens/private keys/cookies in URL query strings.

## Wall / audit
`wall.dashboard.thaiduy.store` is read-only and now has independent local authentication: scrypt password verification, a signed `HttpOnly + Secure + SameSite=Strict` session cookie, and login throttling. NetBird PIN/SSO may remain as an optional outer defense. v0.5 shows `ALL` plus one tab per active/HOLD session, with node/session/agent metadata, stats, jobs, command and output. SSE is primary; deduplicated replay plus a bounded 1-second missed-event probe keeps the Wall near-real-time without turning it into a session heartbeat. Browser/session views are bounded; authoritative full JSONL history is on the VPS with 50 MiB x 3 rotation.

## Hub direction
Current node is `arm`. v0.5 carries `nodeId` in sessions/jobs/logs and treats ARM as the future routing/audit/wall hub. Planned topology is `GPT -> Vercel -> ARM hub -> {ARM, AMD, HomeLab...}`. Remote-node transport is deliberately not claimed implemented until a second executor exists; see `HUB_TOPOLOGY_V0_5.md`.

## v0.6 development branch
`codex/v0.6-device-presence` separates device presence from operator-session lifetime and adds configurable per-session leases. It is branch-only and not production. See `DEVICE_PRESENCE_V0_6.md`.
