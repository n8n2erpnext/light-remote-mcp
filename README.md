# GPT VPS Bridge

Portable private operator bridge for the owner's VPS ARM.

`ChatGPT -> @Vercel -> Vercel Function -> MCP Gateway -> Host Executor (ubuntu) -> VPS ARM`

## Start here

A fresh ChatGPT session should fetch:
`https://gpt-vps-bridge.vercel.app/api/guide`

Repository recovery docs:
- `AI_BRIDGE_GUIDE.md`
- `BRIDGE_V0_3_ARCHITECTURE_PLAN.md`
- `PORTABILITY.md`

## Read-only endpoints

- `GET /api/ping`
- `GET /api/vps-identity`
- `GET /api/system-status`
- `GET /api/workspace-roots`
- `GET /api/fs-list`
- `GET /api/fs-read`
- `GET /api/fs-search`
- `GET /api/git-status`
- `GET /api/git-diff`

## Operator endpoint

Vercel Hobby limits this project to 12 Serverless Functions, so all operator actions share one transport function:

- `GET /api/operator?action=capabilities`
- `GET /api/operator?action=exec&p=<base64url JSON>`
- `GET /api/operator?action=job&id=<job_id>`
- `GET /api/operator?action=output&id=<job_id>&stream=stdout&full=0&offset=0&limit=4194304`

The `exec` action accepts one logical shell batch with stable `operationId`, `cwd`, `script`, timeout, wait window, session ID and audit note. Reuse the same `operationId` only for retries of the same logical action; changing the payload under the same ID is rejected. Build/test/Git/Docker/LXD/system work should be grouped naturally instead of split into artificial one-command calls.

The host executor runs as `ubuntu`. It has the same normal host groups as an interactive operator shell and may use `sudo` on demand; the Internet-facing gateway remains unprivileged and has no Docker socket.

## Security

- Vercel OIDC authenticates the expected team/project/environment.
- Privileged command bodies are sealed with X25519 + HKDF-SHA256 + AES-256-GCM before reaching the gateway.
- The executor enforces short expiry and replay rejection.
- The host private key is never committed or copied into Vercel/gateway.
- Raw secrets must never be placed in URL payloads; use server-side references.

## Observability

The read-only wall mirrors operator command/output history. Live memory is bounded; authoritative JSONL history stays on VPS disk with 50 MB × 3 rotation. Completed job memory is separately bounded and older full output can be reconstructed from disk.

Production v0.4 adds managed multi-agent session lanes on top of the accepted v0.3 operator baseline. The host executor, gateway and Vercel path have passed end-to-end operator checks. The wall is routed through NetBird PIN authentication; RDC remains a temporary rescue path during soak.

## Managed multi-agent sessions (v0.4)

Each agent sends a stable `openId` for one connection attempt and receives a server-issued session before operator work; retries of the same open request are deduplicated. Idle lease is 30 minutes. A running build/test job automatically puts the session in hold, so a 60+ minute LightBI build survives network/Vercel disconnection; when the last job finishes, a fresh 30-minute reconnect grace starts. The live-session ceiling is 8 (target 1–3). There are no repo/file locks: agents coordinate through Git as normal.

Session lifecycle and operator usage are written to VPS JSONL and can be aggregated with `action=session-stats`; Vercel emits structured request logs as the second-side transport trace. See `SESSION_LANES_V0_4.md`.
