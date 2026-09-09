# GPT VPS Bridge v0.3 — Architecture & Operations Plan

Date: 2026-09-09
Status: v0.3 production-active; operator plane enabled and acceptance-tested on 2026-09-09.

## 1. Goal

Build a self-hosted remote operations plane that is practical enough to replace Remote Desktop Commander for daily development/configuration work while remaining observable and explicitly secured.

Primary path:
`ChatGPT -> @Vercel -> gpt-vps-bridge -> MCP Gateway -> Host Executor -> VPS ARM`

The target is capability parity for normal engineering work, not a deliberately crippled read-only shell.

Expected daily capabilities:
- inspect/read/search files
- edit/create/move files
- git inspect/commit/push operations
- run builds/tests/scripts
- manage long-running processes/sessions
- Docker and LXD operations
- system/service configuration
- `sudo` through the host `ubuntu` account where required

Direct unaudited root login is not a design goal; the host executor runs as `ubuntu`, whose existing sudo policy provides elevated operations when explicitly invoked.
## 2. Current production truth

Current MCP gateway is v0.3 and remains an unprivileged container; privileged execution is delegated over a host-only Unix socket to the `ubuntu` executor.

Current controls:
- Vercel OIDC required for `tools/call`
- team/project/environment/audience verification on VPS
- gateway container read-only root filesystem
- dropped Linux capabilities and `no-new-privileges`
- no Docker socket mounted into the public gateway
- filesystem mounts are read-only
- activity wall is a separate read-only HTTP surface

Current read-only tools include:
`ping`, `vps_identity`, `system_status`, `workspace_roots`, `fs_list`, `fs_read_text`, `fs_search`, `git_status`, `git_diff`.

Current guide endpoint:
`https://gpt-vps-bridge.vercel.app/api/guide`

This is the recovery/discovery entry point for a fresh ChatGPT session or another authorized account using @Vercel.

## 3. Target split-plane architecture

Keep the Internet-facing MCP Gateway unprivileged.
Move privileged execution behind a host-only executor running as `ubuntu`.

`MCP Gateway container -> Unix socket or 127.0.0.1 -> Host Executor (ubuntu)`

The executor must not expose a public TCP listener.
## 4. Execution model: grouped commands first

The main execution primitive should be `exec_batch`, not one tool call per shell fragment.

Proposed input:
- `cwd`
- `script`
- `timeout_ms`
- optional `session_id`
- optional `note`/intent for audit context

The script may contain normal shell composition such as `&&`, pipes, loops, heredocs, multiple test/build/deploy commands, and explicit `sudo` where appropriate.

Example logical operation:
`cd repo && git status && npm test && docker compose build && docker compose up -d && docker compose ps`

One logical engineering action should normally consume one remote execution call.

Specialized tools remain useful for structured reads and common operations, but they must not force the agent to split a coherent workflow into dozens of artificial calls.

## 5. Predictable permissions, not hidden/random blocking

The bridge should expose a machine-readable capability description and documented limits.

A denied action must return a deterministic reason such as:
- authentication failed
- capability disabled
- timeout exceeded
- payload too large
- explicit operator policy denied

Avoid opaque or inconsistent "permission denied" behavior when the host account itself has the required permission.

Security restrictions should be explicit, versioned, inspectable, and testable.
## 6. Call-envelope security

Transport HTTPS/TLS remains mandatory, but privileged calls should also use an application-layer authenticated-encryption envelope from Vercel to the host executor.

Recommended envelope:
- AES-256-GCM using a 256-bit bridge key
- fresh 96-bit random nonce per request
- `kid` for key rotation
- request UUID
- issued-at timestamp and short expiry
- session ID
- capability/tool name
- ciphertext containing command arguments/body
- authentication tag

Bind non-secret routing metadata as AEAD additional authenticated data so tampering is detected.

The host executor maintains a short replay cache keyed by request UUID/nonce and rejects:
- expired requests
- duplicate request IDs/nonces
- unknown key IDs
- failed authentication tags

Key material lives only in encrypted Vercel environment storage and a host-side permission-restricted secret file; it is never committed to Git or emitted to logs.

Key rotation should support current + previous key during a short overlap, then retire the previous key.

OIDC remains an independent identity layer. Encryption is defense in depth, not a replacement for OIDC.
## 7. Important ChatGPT -> Vercel constraint

The currently available @Vercel fetch primitive accepts a URL and behaves as a GET-style bridge call.

Therefore arbitrary plaintext secrets must never be embedded in query strings or URL paths.

Normal engineering commands may be transported through the bridge, but secret-bearing actions should reference pre-provisioned server-side secret handles rather than contain the secret value itself.

Examples:
- good: `secret_ref=github_deploy_key`
- good: `env_ref=PROD_DATABASE_URL`
- bad: raw password/token/private key in the request URL

The Vercel Function encrypts the privileged inner call before forwarding it to the VPS executor.

This gives strong application-layer protection for the Vercel-to-VPS leg, while TLS protects the ChatGPT-to-Vercel leg.

Do not claim cryptographic end-to-end secrecy from ChatGPT itself while the only invocation primitive is URL-based.

## 8. Logging: full disk history, bounded live memory

Operational disk logs are authoritative and should preserve full command/stdout/stderr for incident recovery and context rollover reconstruction.

Rotation target:
- active log up to 50 MB
- 3 rotated files
- gzip rotated files
- JSONL or similarly parseable structured records

Redact authentication material and known secret values before persistence, but do not truncate ordinary developer output merely to save space.
## 9. Wall: terminal mirror, read-only

The wall should look and behave like a terminal history viewer, but it must never expose an execution input.

VPS live-memory target:
- byte-based ring buffer: 16 MB
- soft event ceiling: about 5,000 operations/events
- evict oldest data when either limit is reached

Browser target:
- render only the newest 2,000-3,000 blocks
- pause/resume auto-scroll
- load older on demand
- filters by session/tool/status
- expand/collapse command and output
- copy command, copy output, copy raw block

Each execution block should show timestamp, caller/session/request IDs, cwd, tool, script/command, stdout, stderr, exit code, duration and status.

The wall may protect itself from pathological multi-megabyte output, but a truncated wall view must link by request ID to the full disk record.

## 10. Agent response output policy

The agent should receive enough stdout/stderr to understand the operation immediately.

Normal developer output should not be truncated.

For pathological output only, return a generous multi-megabyte response window and preserve useful head + tail portions with explicit metadata: original size, returned size, truncation flag and request ID.

Provide `get_output(request_id, offset/range)` so the agent can fetch more without manually searching raw log files.
## 11. Session recovery and handoff

A fresh ChatGPT session should be able to recover without relying on memory.

Recovery order:
1. discover Vercel project `gpt-vps-bridge`
2. fetch `/api/guide`
3. read `AI_BRIDGE_GUIDE.md`
4. read this architecture plan if privileged work is involved
5. read current checkpoint/session summary
6. inspect recent operational logs only when necessary

Maintain a small machine-readable checkpoint with current repo, branch, commit, last completed action, active request/session and recommended next action.

## 12. Rollout order

Phase A: read-only v0.2 baseline — complete.

Phase B: disk logging, 16 MB wall buffer and richer terminal-style wall — complete.

Phase C: host executor as `ubuntu`, reachable only by Unix socket — complete.

Phase D: encrypted/replay-protected call envelope and capability/status endpoint — complete.

Phase E: `exec_batch`, async job lookup and output retrieval — complete.

Phase F: filesystem mutation, Git/build/test, Docker/LXD and sudo-backed system capability acceptance — complete for operator shell semantics; keep RDC as rescue during soak.

RDC remains a rescue path until the self-hosted bridge has proven stable across real daily work.