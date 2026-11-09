# Light Remote MCP — Unified Project Book

Status: current source-scoped synthesis
Edition: 2026-11-09
Source authority: new GitHub repository n8n2erpnext/light-remote-mcp; main = stable baseline, Owner-authorized work = sole development branch (2026-11-08)
Current compiled candidate source: 31f23393aacb89b6d541cebb2cd0c2e1afa64538; full CI #30 42549642811 PASS9/9. Documentation receipts may follow without rebuilding that installer. Original reconstruction source c03b50f and isolated ARM deployment retain their own evidence scope.
Version: 0.10.1-dev.2; API: light-remote.api.v1; profile: goldabv2-desktop-v4

## What exists

The current **independent unified** repository holds source for Device Agent/Local Wall, Plugin Server, Operator, Desktop V4 (React/Tauri native), Windows in-process managed host/private frameworks and independent updater, supporting native RM clients, SQL migrations, shared libraries and isolated DEV orchestration. It is not a copy of the pre-reconstruction Git commit ancestry.

The documented baseline identifies clean initial Git root aa378ba, new repository ID 1450214328, and an archived **different** old repository. It has a selected code tree and reproducible source origins in [Migration Provenance](../../MIGRATION_PROVENANCE.md). See [Component Inventory](../../COMPONENT_INVENTORY.md), [Architecture](../../ARCHITECTURE.md) and [Code Map](LIGHT_REMOTE_CODE_MAP.md).

## What was actually verified

- [GitHub CI #30](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42549642811), built source31f2339, reports9/9 PASS, including actual one-primary installation/GUI/private CLR, Agent restart isolation, real bridge upgrade/reinstall/failure rollback/native watchdog/uninstall and backend integration. [Primary manifest](../evidence/windows-one-primary/PRIMARY_EXE_MANIFEST.json) and [CI acceptance](../evidence/windows-one-primary/CI_ACCEPTANCE.json) pin exact scope.
- The privately isolated backend/Agent candidate built from the exact new GitHub commit reports 21/21 integration checks PASS in [DEV evidence](../evidence/dev-integration.json).
- The current Windows installer/artifact hashes were independently verified on ARM and after transfer to the local workspace; see [artifact verification](../evidence/windows-one-primary/ARTIFACT_VERIFICATION.json). Public binary release awaits explicit Owner approval. Earlier c03b50f Windows/ARM evidence remains historical and is not relabelled as this candidate.
- **No physical Owner acceptance against this new backend is established**; CI/browser/native component checks do not substitute for it. Current source routes are not evidence that a legacy Lab runs those routes.

## What is missing or still separate

Owner native GUI physical acceptance against the candidate, positive local Agent/browser SSO redemption, signed B/command exercise on new candidate, continuity integration, complete endpoint/schema catalog, some archived prototypes, full Mac/Linux packages, physical acceptance of the new single-primary Windows candidate and signed public update-feed migration remain open. Read [Known Issues](../../KNOWN_ISSUES.md) and [Roadmap](../../ROADMAP.md) before creating a task; do not invent more gates.

## How to maintain this project

Official source and build authority is the new GitHub repository: Owner-authorized `work` for development/CI, protected `main` for verified stable baseline; never old VPS-ARM STAGED directories. Capture a full checkpoint/tag **before** a significant change, develop only on the authorized work branch, and keep [Worklog](LIGHT_REMOTE_WORKLOG.md), [Code Map](LIGHT_REMOTE_CODE_MAP.md) and [MASTER_CHECKPOINT.json](../../MASTER_CHECKPOINT.json) aligned. Only perform regression relevant to the changed boundary and a final integrated acceptance for a candidate. Never infer production release from a green CI job.

## Source navigation

- API names/flags: [API contract](../../contracts/api.v1.json), [endpoint config](../../config/endpoints.json).
- Desktop app: [React app](../../client/desktop-v4/src/App.tsx), [Tauri commands](../../client/desktop-v4/src-tauri/src/main.rs).
- Agent and Wall: [Agent entry](../../device-agent/desktop-abv2-native-ipc-v4.mjs), [Wall memory modules](../../device-agent/gold-wall-modules.mjs).
- Backend: [Plugin entry](../../plugin-server/server.mjs), [Owner routes](../../plugin-server/desktop-owner-token-v4.mjs), [Operator entry](../../operator-host/executor.mjs), [Owner Snapshot](../../operator-host/desktop-v4-owner-snapshot.mjs).
- Persistence: [SQL lock](../../platform-v2/sql/migrations.lock.json) and [Project Manifest](../../project.manifest.json).
- DEV/test: [Unified test plan](../../deploy/unified/test-plan.json), [DEV runner](../../deploy/unified/dev.py).
