# Light Remote MCP — Unified Code Map

Status: canonical source navigation, not runtime deployment proof
Edition: 2026-11-08
Codebase: fresh n8n2erpnext/light-remote-mcp main, 0.10.0-dev.1
Verified reference: de7eb2264d88546ecea00991730e596ee42768d3 (documentation baseline)
API contract: [light-remote.api.v1](../../contracts/api.v1.json)
Endpoint catalog: [config/endpoints.json](../../config/endpoints.json)

## Runtime and trust boundaries

| Area | Verified source owner | Boundary / responsibility |
| --- | --- | --- |
| Operator entry and routing | [executor.mjs](../../operator-host/executor.mjs), [account routes](../../operator-host/executor-routes-account.mjs), [runtime routes](../../operator-host/executor-routes-runtime.mjs) | Server-side authority, account-scoped actions, private routes |
| Owner Snapshot | [desktop-v4-owner-snapshot.mjs](../../operator-host/desktop-v4-owner-snapshot.mjs), [activity page](../../operator-host/desktop-v4-owner-activity-page.test.mjs) | Device, grants, usage, jobs and sessions read models; not granting execution |
| A/B authority and sessions | [gold-ab-v2-grant-operator.mjs](../../operator-host/gold-ab-v2-grant-operator.mjs), [pending registry](../../lib/gold-ab-v2-pending-redis.mjs), [session store](../../lib/gold-session-redis.mjs) | Consent, device proof, owner/agent session lifecycle |
| Plugin server and OAuth | [server.mjs](../../plugin-server/server.mjs), [owner token routes](../../plugin-server/desktop-owner-token-v4.mjs), [operator client](../../plugin-server/operator-client.mjs) | External owner-facing endpoints, PKCE/Owner token, private Operator bridge |
| Desktop Wall SSO | [plugin public redeem](../../plugin-server/desktop-wall-sso-public-redeem-v4.mjs), [trusted Operator route](../../operator-host/desktop-wall-sso-signed-route-v4.mjs), [Agent transport](../../device-agent/desktop-wall-sso-agent-transport-v4.mjs), [browser bootstrap](../../device-agent/desktop-wall-sso-browser-bootstrap-v4.mjs) | Local owner consent + signed/device-bound ticket; live E2E incomplete |
| Local Agent A/B native IPC | [desktop-abv2-native-ipc-v4.mjs](../../device-agent/desktop-abv2-native-ipc-v4.mjs), [Windows Host](../../client/windows-native/GptOperator.Client/AgentHost.cs) | Local process/named pipe boundary; not equivalent to remote B acceptance |
| Local Wall & modules | [fleet-wall-runtime.mjs](../../device-agent/fleet-wall-runtime.mjs), [gold-wall-modules.mjs](../../device-agent/gold-wall-modules.mjs), [local activity log](../../device-agent/local-activity-log.mjs) | Device-local Wall, state and module requests |
| Desktop web UI | [App.tsx](../../client/desktop-v4/src/App.tsx), [FeatureScreens.tsx](../../client/desktop-v4/src/FeatureScreens.tsx), [native snapshot](../../client/desktop-v4/src/lib/native-snapshot.ts), [native inventory](../../client/desktop-v4/src/lib/native-inventory.ts) | Owner view; typed native commands, no direct cloud credential in UI |
| Desktop Tauri native | [main.rs](../../client/desktop-v4/src-tauri/src/main.rs), [owner_login.rs](../../client/desktop-v4/src-tauri/src/owner_login.rs), [owner_abv2.rs](../../client/desktop-v4/src-tauri/src/owner_abv2.rs), [owner vault](../../client/desktop-v4/src-tauri/src/owner_vault.rs), [endpoint config](../../client/desktop-v4/src-tauri/src/endpoint_config.rs) | Native storage, HTTP Owner snapshot, B-command preview/approval |
| Windows desktop host/tray | [Program.cs](../../client/windows-native/GptOperator.Client/Program.cs), [AgentSupervisor.cs](../../client/windows-native/GptOperator.Client/AgentSupervisor.cs), [TrayApplicationContext.cs](../../client/windows-native/GptOperator.Client/TrayApplicationContext.cs) | Host process, supervisor, native tray lifecycle |
| Windows updater/installer | [UpdateApplier.cs](../../client/windows-native/LightRemote.Updater/UpdateApplier.cs), [installer](../../client/windows-native/installer/GptOperator.iss) | Installer packaging/update; CI PASS != Owner physical PASS |
| Remote execution/shared services | [native terminal](../../lib/native-terminal.mjs), [SCP file](../../lib/light-scp-file.mjs), [process supervisor](../../device-agent/process-supervisor.mjs) | PTY/job/file execution under active Agent authorization |
| Persistence | [core SQL lock](../../platform-v2/sql/migrations.lock.json), [Owner extension SQL](../../platform-v2/sql/045_gold_single_owner_authority.sql), [project.manifest.json](../../project.manifest.json) | Explicit schema authority; 044 Pro Share remains deferred |
| Deployment & tests | [DEV runner](../../deploy/unified/dev.py), [test runner](../../deploy/unified/test.mjs), [test plan](../../deploy/unified/test-plan.json), [build manifest](../../deploy/unified/build-manifest.mjs) | Isolated candidate, pinned source/artifact proofs |
| Atomic commit gate | [commit-sync-gate.mjs](../../deploy/unified/commit-sync-gate.mjs), [pre-commit](../../.githooks/pre-commit), [CI truth](../../.github/workflows/ci.yml) | Reject code/docs commits lacking staged checkpoint, new handoff+Worklog receipt, exact Git source digest and affected docs; CI checks each new commit |
| Project truth | [truth check](../../deploy/unified/check-truth.mjs), [master checkpoint](../../MASTER_CHECKPOINT.json), [project truth](../../PROJECT_TRUTH.md) | One unified truth, no legacy .light-remote checkpoint |

## Owner Desktop V4 path — source, not a live Lab guarantee

1. [UI App](../../client/desktop-v4/src/App.tsx) reads native [Owner snapshot adapter](../../client/desktop-v4/src/lib/native-snapshot.ts).
2. [Tauri Owner command](../../client/desktop-v4/src-tauri/src/owner_login.rs) invokes the configured endpoint in [endpoint_config.rs](../../client/desktop-v4/src-tauri/src/endpoint_config.rs).
3. [Plugin Owner token route](../../plugin-server/desktop-owner-token-v4.mjs) handles Owner-bound read and calls the private Operator bridge.
4. [Operator account route](../../operator-host/executor-routes-account.mjs) is gated by LR_GOLD_ABV2_DESKTOP_READ_V4, using [Owner Snapshot read model](../../operator-host/desktop-v4-owner-snapshot.mjs).
5. [API contract](../../contracts/api.v1.json) and [endpoint config](../../config/endpoints.json) define routes and flags. Flag state **must** be observed in the deployed runtime; source file presence is insufficient.

## Canonical configured routes

The authoritative machine definitions are [config/endpoints.json](../../config/endpoints.json) and [contracts/api.v1.json](../../contracts/api.v1.json). These are **source declarations**, not proof of the API being enabled or deployed.

| Route key | Role | Method | Path |
| --- | --- | --- | --- |
| ownerAuthorize | owner | GET | /account/desktop/v4/authorize |
| ownerToken | owner | POST | /account/desktop/v4/token |
| ownerRefresh | owner | POST | /account/desktop/v4/refresh |
| ownerSession | owner | GET | /account/desktop/v4/session |
| ownerSnapshot | owner | POST | /account/desktop/v4/snapshot |
| ownerLogout | owner | POST | /account/desktop/v4/logout |
| ownerWallTicket | owner | POST | /account/desktop/v4/wall-sso/ticket |
| operatorOwnerSnapshot | operator/private-unix | POST | /v1/accounts/desktop-v4/snapshot |
| wallApprovePage | local.wall | GET | /approve |
| wallBApprove | local.wall | POST | /api/abv2/approve |
| wallModulesRead | local.wall | GET | /api/gold/modules |
| wallModulesConfigure | local.wall | POST | /api/gold/modules/configure |

Other route families exist; this table intentionally documents the relevant V4 control boundary and is not an exhaustive route/schema inventory. Use actual endpoint config for additions.

## Source status and regression boundaries

- Implemented: source modules above exist in the unified repository.
- Build/CI proven: source c03b50f, [CI summary](../../PROJECT_TRUTH.md) and [evidence](../evidence/ci-status.json).
- Isolated DEV integrated: [21-check receipt](../evidence/dev-integration.json) for candidate at c03b50f.
- Unknown/not complete: new-backend Owner physical UAT, full Agent/browser SSO, live signed B-command, full public release/feed; see [Known Issues](../../KNOWN_ISSUES.md).
- Historical physical Windows proof 4dddf511 belongs to the **old** artifact; do not transfer it to the new build.

## Updating this map

Change this file when executable ownership, route/flag, IPC/transport, SQL or packaging boundary changes. Link to actual files in the **new** repo. Record the milestone in [Worklog](LIGHT_REMOTE_WORKLOG.md) and root [Checkpoint](../../MASTER_CHECKPOINT.json); run the project-book check. Do not paste a 188 KB legacy map or infer present truth from a historical handoff.
