# Project Continuity — Gold inheritance and device-level module correction

Date: 2026-10-24, Asia/Ho_Chi_Minh
Branch: feature/project-continuity-plan-20261023
Previous commit: 42f521acdd31afc8021c3c9dd930faa5615ba7dc
Frozen owner-tested Windows #486 source: 30766940ac18e55cb735354b40a3af9ba37eddb8
Gold M6 integration worktree: ba579f8830a0654e8321204f17270db8d94c5593

## Original owner requirement recovered

Gold and its complete, tested Client/Operator Agent/Wall/Fleet/Permissions/A-B/enrollment/brand/runtime are the FOUNDATION, not a reference to rebuild from. Project Continuity is an optional extension IN THE SAME GOLD WALL AND AGENT. Never create a separate administration system, a new Wall with placeholder callbacks, or a fake Link Device and empty Permissions screen.

Project Memory and Codex Bridge are INDEPENDENT Light Remote device-level optional modules. There must be NO requirement to create or select a Project to activate either. Four modes:

- Memory OFF + Codex OFF: ordinary Gold remains functional, with no extra dependency.
- Memory ON + Codex OFF: authorized ChatGPT conversations can reuse local long-term context without a Codex subscription.
- Memory OFF + Codex ON: actual Codex delegated worker can operate independently with the deterministic Task Controller, without Memory.
- Memory ON + Codex ON: Codex can use Memory context and Controller checkpoints while remaining governed.

Task Controller is the authoritative state/approval/evidence/unknown controller, not a mandatory third user-purchased toggle. SQLite WAL and optional JSON belong LOCALLY; Gold cloud PostgreSQL17 + Redis8 remains canonical for other Gold runtime data, not private Project Memory bodies.

Projects are OPTIONAL scopes for organizational details, tasks and focused notes. They are NOT the prerequisite for module availability.

## Corrective implementation in source (not release acceptance)

- device-agent/project-continuity-store.mjs: additive SQLite v9 singleton device_modules for independent Memory/Codex switches, defaults OFF/OFF with zero Projects. Migration preserves previously explicit project opt-ins; changes are applied atomically across legacy compatibility fields. Disabling Memory revokes all previous remote-read consents and attestations. A hidden default scope enables local Memory fact storage/search without a user-created Project. New optional Projects inherit device settings.
- device-agent/project-continuity-page.mjs: independent device-level module controls ABOVE Projects, default Memory capture/search without Project selection. Per-Project module controls removed; Project detail retains tasks, scoped notes and separately approved remote sharing. UI clearly marks Codex worker not operational yet.
- device-agent/local-wall.mjs, project-continuity-owner-broker.mjs, project-continuity-ipc.mjs: new getGlobalModules/setGlobalModules API; no per-Project setModules action exposed through ordinary owner Wall API or generic local IPC. Older store method remains temporarily for legacy internal test migration, not publicly exposed.
- deploy/scripts/selftest-project-continuity-device-modules.mjs: source guard on 100% of frozen #486 Client package paths and four ON/OFF combinations without Project, implicit default Memory, fresh optional Project inheritance and SQLite restart. P1/P2 and broker fixtures updated to use device-level API where relevant.

Crucial difference: source manifest superset does NOT prove fully working Gold Agent runtime. Official Gold Cloud enrollment/permissions/Fleet, real device capabilities, live A/B session and visual parity STILL require an installed FULL Gold candidate, not a synthetic callback object.

## Invalid test instance retired without data loss

The previously published NetBird 100.94.184.141:5587 pseudo-Gold Wall was misleading. On the isolated light-remote-continuity-uat ONLY:
- Disabled/stopped light-remote-continuity-web-uat.service.
- Removed LXD proxy device continuity-webui-netbird.
- Preserved broker light-remote-continuity-uat.service, private SQLite, signing/trust keys, notes and Project records.
- Left existing production, Gold M6 worktree, Gold UAT Plugin/Operator/Wall services and Windows #486 untouched.

Do NOT advertise port 5587 as a valid Gold Wall anymore. Future UAT may use an isolated port only after the WHOLE Gold runtime is present and approved to test.

## Verified / not verified

Verified source/tests:
- GOLD_486_BASELINE_PACKAGED_SOURCES_ALL_INHERITED_PASS (manifest, not real runtime).
- MODULES_OFF_OFF_WITH_ZERO_PROJECTS_PASS.
- MEMORY_ONLY_ACTIVATES_WITHOUT_PROJECT_CREATION_PASS.
- CODEX_ONLY_ACTIVATES_WITHOUT_MEMORY_PASS.
- BOTH_ON_PRESERVES_EXISTING_MEMORY_AND_CODEX_PASS.
- BOTH_OFF_REVOKES_EXECUTION_AND_NEW_PROJECTS_DEFAULT_OFF_PASS.
- GLOBAL_SWITCHES_SQLITE_RESTART_PERSIST_PASS.
- WALL_MODULE_SWITCHES_OUTSIDE_PROJECT_AND_NO_LEGACY_TOGGLE_PASS.
- P1/P2 local data/rekey/migration/consent and two-UID Operator-signed broker proof focused tests.
- Gold installed four UAT services unaffected.

OPEN for release:
- FULL real Gold Client/Agent/Wall/enrollment/Permissions/Fleet A/B/brand/runtime end-to-end inherited.
- Actual Codex API/app-server worker, cancellation, budgets, owner approvals and durable receipts (ON flag alone is not functionality).
- Real ChatGPT Web memory retrieval across chats through official plugin and consent with no cloud memory persistence.
- Global module switch owner-verification at broker OS security boundary; same-group local IPC access alone is not sufficient.
- Windows native DACL/Service SID/CNG and physical #486 parity; Linux Server full Gold integration; macOS launchd/Keychain and Linux Desktop systemd, all four module configurations.
- Safe upgrade/rollback and only ONE owner test installer after full feature readiness.
- Gold M6 UNKNOWN jobs and pending resource claims must not be reset or cleared.

## Next exact action

Deploy a COMPLETE test copy of the verified Gold Client/Operator Agent runtime with its native Wall, enrollment, permissions, brand and Fleet, then inject this device-global Continuity module through the existing feature flag. Never bring the old pseudo-Wall back. Complete and verify the real Codex worker and ChatGPT Web cross-session flows, followed by OS parity; continue detailed handoff after every work turn.
