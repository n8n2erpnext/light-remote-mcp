# GPT VPS Bridge — Current State

Updated: 2026-09-09
Version: v0.3 production-active

## Active path
`ChatGPT -> @Vercel -> gpt-vps-bridge.vercel.app -> mcp.dashboard.thaiduy.store -> MCP Gateway -> Unix socket -> gpt-vps-operator (ubuntu)`

## Production facts
- MCP gateway: v0.3, unprivileged/read-only container, no Docker socket.
- Host executor: `gpt-vps-operator.service`, user `ubuntu`, Unix socket only.
- Operator capabilities proven: filesystem, Git, build/test, Docker, LXD, systemctl and sudo-on-demand.
- Caller auth: Vercel OIDC pinned to expected team/project/environment/audience.
- Privileged envelope: X25519 + HKDF-SHA256 + AES-256-GCM, short expiry and crypto replay rejection.
- Logical execution idempotency: stable `operationId`; exact retry returns prior job, changed payload under same ID is rejected.
- Wall: `wall.dashboard.thaiduy.store`, read-only and routed through NetBird PIN authentication.
- Live wall buffer: 16 MiB / 5000 events; browser DOM bounded.
- Authoritative audit: `/var/log/gpt-vps-operator/operations.jsonl`, rotate 50 MiB x 3.
- Agent output cache: 4 MiB per stream with full-output retrieval from disk.
- Completed job cache: 64 MiB / 6 hours.
- Vercel Hobby deployment stays below the 12-function limit by multiplexing operator actions through `/api/operator`.

## Recovery order
Fetch `/api/guide`, then read `AI_BRIDGE_GUIDE.md`, this file, and `BRIDGE_V0_3_ARCHITECTURE_PLAN.md`. Use disk logs only when recent response/job output is insufficient. RDC is rescue-only during soak.

## Final acceptance 2026-09-09
- E2E mutation/build through @Vercel -> encrypted gateway -> host executor: PASS.
- Exact retry with same `operationId`: same job returned, no duplicate side effect: PASS.
- Changed payload under same `operationId`: HTTP 409 `operation_id_conflict`: PASS.
- Async execution: returned `running`, later job/output retrieval returned `async-ok`: PASS.
- Timeout enforcement: 1500 ms job ended `timeout` with `SIGTERM`; post-timeout command did not execute: PASS.
- Executor restart without gateway recreate: stable socket bind remained usable: PASS.
- Wall unauthenticated access: NetBird auth returned HTTP 401: PASS.

Stable socket host path: `/home/ubuntu/.local/run/gpt-vps-operator/operator.sock`.
The gateway bind-mounts its parent directory read-only so executor socket recreation is visible without recreating the container.
