# Light Remote MCP — Unified Project Book

Status: current source-scoped synthesis
Edition: 2026-11-08
Source authority: new GitHub repository n8n2erpnext/light-remote-mcp; main = stable baseline, Owner-authorized work = sole development branch (2026-11-08)
Docs-integrated repository reference: 23f386ee7bcef6c5547eee8e7a7f0ccaab5a0227; verified documented migration de7eb226; verified built source c03b50f4328e07138f350532c31dfc8b260311ce
Version: 0.10.0-dev.1; API: light-remote.api.v1; profile: goldabv2-desktop-v4

## What exists

The current **independent unified** repository holds source for Device Agent/Local Wall, Plugin Server, Operator, Desktop V4 (React/Tauri native), Windows C# host/updater, supporting native RM clients, SQL migrations, shared libraries and isolated DEV orchestration. It is not a copy of the pre-reconstruction Git commit ancestry.

The documented baseline identifies clean initial Git root aa378ba, new repository ID 1450214328, and an archived **different** old repository. It has a selected code tree and reproducible source origins in [Migration Provenance](../../MIGRATION_PROVENANCE.md). See [Component Inventory](../../COMPONENT_INVENTORY.md), [Architecture](../../ARCHITECTURE.md) and [Code Map](LIGHT_REMOTE_CODE_MAP.md).

## What was actually verified

- GitHub CI 42475715858, built source c03b50f, reports 9/9 jobs PASS (build/test scope described in [Project Truth](../../PROJECT_TRUTH.md)).
- The privately isolated backend/Agent candidate built from the exact new GitHub commit reports 21/21 integration checks PASS in [DEV evidence](../evidence/dev-integration.json).
- The new Windows installer was checked against a pinned artifact/hash on ARM in [Windows artifact evidence](../evidence/windows-artifact-verification.json).
- **No physical Owner acceptance against this new backend is established**; CI/browser/native component checks do not substitute for it. Current source routes are not evidence that a legacy Lab runs those routes.

## What is missing or still separate

Owner native GUI physical acceptance against the candidate, positive local Agent/browser SSO redemption, signed B/command exercise on new candidate, continuity integration, complete endpoint/schema catalog, some archived prototypes, full Mac/Linux packages, single primary Windows EXE and signed public update-feed migration remain open. Read [Known Issues](../../KNOWN_ISSUES.md) and [Roadmap](../../ROADMAP.md) before creating a task; do not invent more gates.

## How to maintain this project

Official source and build authority is the new GitHub repository: Owner-authorized `work` for development/CI, protected `main` for verified stable baseline; never old VPS-ARM STAGED directories. Capture a full checkpoint/tag **before** a significant change, develop on the same main where allowed, and keep [Worklog](LIGHT_REMOTE_WORKLOG.md), [Code Map](LIGHT_REMOTE_CODE_MAP.md) and [MASTER_CHECKPOINT.json](../../MASTER_CHECKPOINT.json) aligned. Only perform regression relevant to the changed boundary and a final integrated acceptance for a candidate. Never infer production release from a green CI job.

## Source navigation

- API names/flags: [API contract](../../contracts/api.v1.json), [endpoint config](../../config/endpoints.json).
- Desktop app: [React app](../../client/desktop-v4/src/App.tsx), [Tauri commands](../../client/desktop-v4/src-tauri/src/main.rs).
- Agent and Wall: [Agent entry](../../device-agent/desktop-abv2-native-ipc-v4.mjs), [Wall memory modules](../../device-agent/gold-wall-modules.mjs).
- Backend: [Plugin entry](../../plugin-server/server.mjs), [Owner routes](../../plugin-server/desktop-owner-token-v4.mjs), [Operator entry](../../operator-host/executor.mjs), [Owner Snapshot](../../operator-host/desktop-v4-owner-snapshot.mjs).
- Persistence: [SQL lock](../../platform-v2/sql/migrations.lock.json) and [Project Manifest](../../project.manifest.json).
- DEV/test: [Unified test plan](../../deploy/unified/test-plan.json), [DEV runner](../../deploy/unified/dev.py).
