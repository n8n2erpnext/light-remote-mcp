# Gold Multi-OS Owner Permissions — UAT handoff (2026-10-22)

## Goals and guarantees
- The Agent must support the **full OS-specific permission catalog** whether tools are installed or not. Each tool's installation status is read-only inventory, never a permission ceiling.
- Owner controls File/Development, PTY (single independent ON/OFF), Desktop View vs Real Remote Input, Containers/VM/Kubernetes, Package/Services, Network/Firewall, Storage/Provisioning, OS Security/Logs. Unknown future OS capabilities appear in a fallback group.
- Profile shortcuts: Safe, Developer, Remote Support, Infra/Ops, Full access, Custom. Full access selects all device-supported rights, not elevated OS privileges outside the service account.
- New server permissions start **unapproved**; merely holding the Agent device key or clicking a local Wall checkbox never grants server approval. Only owner-confirmed capability sets become effective.
- The owner confirms a change from the **account-only Local Wall** with their Light Remote account password. Password is used only for a signed, authenticated one-shot request; never stored in Agent state or logs. The Operator re-verifies account credentials, checks account/device binding, writes approved/grantable/revision to PostgreSQL and flushes before returning an Ed25519-signed policy envelope.
- PTY is an intentional unrestricted interactive shell permission within the device service account; per-command classification cannot constrain its input. Do not imply finer enforcement for commands entered into PTY.
- Linux root/systemd sandbox and host-write installer permissions remain independent of Local Wall authorization. New capabilities do not elevate Linux user or bypass systemd.

## Source and CI receipts
- Branch: `fix/docker-capability-refresh-20261022`.
- Owner verification + PG persistence commit: `7236c29ea19a07b5e2a06521fb719262de05eb4d`. CI [Linux #318](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39813442576) **success** x64/ARM64; ARM64 artifact ID `12440997688`.
- Startup signed catalog sync commit: `44c8ecb14b735acbc0ff610c240045c91f3499dc`. CI [Linux #319](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39814778034); verify final run result before installing.
- Unit/integration: `node deploy/scripts/selftest-gold-owner-permission-authorization.mjs` PASS device proof gate, password check, owner/device binding and durable PostgreSQL registry flush. `node deploy/scripts/selftest-gold-owner-wall-browser.mjs` PASS authenticated account-only Chromium login, CSRF, wrong password denied, correct owner approval, local policy saved and effective UI updated. Existing cross-OS catalog, signed rescan, and Wall group browser tests PASS.
- Gold migration guard accepts **only exact contiguous 1–34 or 1–35 ledgers**; for 35 the specific terminal ACK relation is required. This restores current UAT Operator after migration 35 previously applied without running/reverting any migrations.

## Current Gold UAT deployment (wall/operator only)
- LXD: `light-remote-gold-uat` on VPS-ARM; NetBird Wall `http://100.94.184.141:5591/permissions`.
- Operator overlay candidate `/opt/light-remote-gold-uat-permissions-candidates/owner-7236c29`, created by cloning **currently running** `/opt/light-remote-gold-uat-candidates/permissions-49807f5` and only patching `operator-host/executor.mjs` (durable PG flush dependency) and `operator-host/executor-routes-device-channel.mjs` (signed rescan + owner-confirmed approval). No M5/M6 scheduling code was replaced.
- Systemd override: `/etc/systemd/system/light-remote-gold-operator.service.d/zz-owner-permissions-7236c29.conf` — Operator active; invalid owner request gives HTTP 400 from UNIX socket (proof gate) rather than route 404.
- Wall CI #318 ARM64 candidate `/opt/light-remote-gold-uat-wall-ci/7236c29ea19a07b5e2a06521fb719262de05eb4d/package`; `/etc/systemd/system/light-remote-gold-wall.service.d/zz-owner-permissions-7236c29.conf`; operator socket `/run/light-remote-gold-uat/operator.sock` enabled only for capability refresh/owner approval. Local Wall remains account-only authenticated and HTTP 303 for unauthenticated /permissions.
- CI #318 ARM64 artifact tar SHA256: `d3426bd8c9924964f309cdab38a47e73c7b9f1e4c06222abdd870dbde9076e0a`.
- Gold UAT native PostgreSQL/Redis, Plugin, independent process supervisor and production unchanged. Owner intent to HOLD the M plan respected. PG `lr_gold_device_resource_claims` retains 1 running resource claim; no release, migration or queue changes made.
- Known pre-existing cross-version M5 issue: `terminal_receipt_refresh_failed: supervisor_owner_invalid`, because M5 supervisor does not support the new terminal receipt API. Do not claim receipt E2E passed; fix separately after owner resumes M plan.

## Rollback, ONLY after owner instruction
- Operator: remove its `zz-owner-permissions-7236c29.conf` drop-in in the LXD, `systemctl daemon-reload`, restart only `light-remote-gold-operator`. Previous working candidate `permissions-49807f5` stays as base.
- Wall: remove its `zz-owner-permissions-7236c29.conf` drop-in, daemon-reload, restart only `light-remote-gold-wall`. Previous CI #315/other drop-ins are retained. Do not overwrite Wall account or enrollment state.
- Neither rollback touches PostgreSQL/Redis, Gold Plugin, M5/M6 jobs, claims, or production.

## Remaining acceptance
1. CI #319 artifact signed/catalog check and if PASS install Wall candidate; verify Agent automatically refreshes supported grantable capabilities on startup. Server-approved existing rights stay unchanged; newly supported rights remain locally denied until owner selects.
2. Account-only owner signs in, selects Full access or granular rights, chooses Save or the explicit **Verify owner & approve selected** action. Must use valid account credentials without asking ChatGPT for password. Check server-revision increment, PostgreSQL persistence (write→read→operator restart→read), and new effective capabilities.
3. Exercise allowed/denied commands for filesystem, SCP, Docker/LXD, PTY and RM View/Input on real OS in UAT. Do not claim all OSes physically tested from ARM Linux-only UAT; macOS/Windows still need native validation.
