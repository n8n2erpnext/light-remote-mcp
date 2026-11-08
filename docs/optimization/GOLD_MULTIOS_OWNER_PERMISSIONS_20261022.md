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

## 2026-10-22 — Plugin schema-35 recovery / final Gold UAT permission receipts

**Supersedes the earlier "Plugin unchanged" runtime statement above**: the Plugin was discovered crash-looping (317 failed restarts) due to stale `gold_pg_migrations_missing` validation of exactly 34 revisions against a PostgreSQL ledger of 35. This repeatedly restarted Wall through its systemd dependency and made the remote channel return transient HTTP 502.

- Repair was **runtime-only, UAT-only**, not an M plan rollout. Cloned the previously active plugin candidate `/opt/light-remote-gold-uat-candidates/b99cd6469f0a5ed325a176e1417db2d2c5c00c4b` into `/opt/light-remote-gold-uat-permissions-candidates/plugin-schema35-20261022`. Replaced **only** `lib/gold-db.mjs` with the Gold fix variant; comparison verified that it differs solely in the strict migration validator.
- Validator accepts only contiguous revision ledger 1–34 or 1–35, and when 35 is present explicitly verifies `public.lr_gold_terminal_receipt_acks` exists. Does not add, apply, delete or rollback migrations.
- New systemd override `/etc/systemd/system/light-remote-gold-plugin.service.d/zz-permissions-schema35-20261022.conf` activates that plugin candidate. Previous systemd override and source remain intact for rollback.
- Plugin listened on `10.192.135.61:5583`, accepted the expected host `gold.light-remote.thaiduy.digital` with HTTP 200 and held **the same PID** during a 10-second runtime stability check. Subsequent read-only audit confirmed the Plugin, Operator, Wall and Process Supervisor active, Wall unauthenticated `/permissions` HTTP 303 login redirect and `/api/policy-status` HTTP 401, signed owner policy endpoint unauthenticated rejection HTTP 400. Plugin's historical `NRestarts=317` is a cumulative counter, **not** new restarts after recovery.
- Server-side PostgreSQL grantable rights remained **17** for Linux UAT with no implicit approval during Agent rescan. At the first post-fix read 17 grantable / 8 approved / policy revision 2, nine new capabilities denied locally.
- **Later, at 2026-10-22 16:52:02 UTC**, a new owner policy was observed in DB: device `dev_e68276c691ba5413f42d5dde` had profile `full`, policy revision **3**, **17 grantable / 17 approved**. The Agent's local policy also reported profile `full`, **17 locally requested / 0 denied / 17 effective**, revision 3. No owner credentials were read or logged by the assistant and no approval request was issued by the assistant. This demonstrates live effective-policy propagation but **does not establish physical sudo/root authority** or exhaustive command-level enforcement tests.
- PostgreSQL `lr_gold_device_resource_claims` still had **1 running** resource claim. M plan remains **HOLD**: no release, cancellation, queue intervention, migration execution, Fleet cutover, or production changes.
- The prior `terminal_receipt_refresh_failed: supervisor_owner_invalid` M5 supervisor mismatch remains a separate issue; do not claim resolved. Linux ARM64 UAT alone does not constitute Windows/macOS native acceptance.

### UAT-only rollback (only upon explicit instruction)
- Plugin: remove its `zz-permissions-schema35-20261022.conf` and run `systemctl daemon-reload && systemctl restart light-remote-gold-plugin.service` inside `light-remote-gold-uat`. **Warning:** this reverts to the incompatible 34-migration Plugin and is expected to restore crash-loop on a 35-migration DB; prefer a known compatible candidate instead. No DB rollback.
- Operator/Wall: follow the separate owner permissions overrides described above. Preserve the existing account/enrollment state and the M5 resource claim.
- Handoff focus for future testing: deny/effective behavior by entrypoint, native macOS/Windows permissions tests, M5 receipt compatibility only when M plan resumes. Avoid repeated synthetic validation loops.

### Source and release
- Permission-owner feature: `7236c29ea19a07b5e2a06521fb719262de05eb4d`.
- Agent startup automatic rescan: `44c8ecb14b735acbc0ff610c240045c91f3499dc` (CI #319 ARM64 tar SHA-256 `718cc451b625b720b28122a6e8529c43daa917d238553802c452361762130b79`, validated against CI SHA256SUMS and unpacked into its own candidate before Wall-only activation).
- The Gold UAT Plugin fix follows the shared `lib/gold-db.mjs` implementation already committed in `7236c29`; no separate production plugin build or release occurred.
