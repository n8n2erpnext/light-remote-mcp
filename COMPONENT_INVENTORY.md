# Component inventory

| Component | Active source | Selected origin / assessment |
|---|---|---|
| Agent, Local Wall, A/B client, durable execution | `device-agent/`, `lib/` | Desktop eb9a6487; T11 regression corrections retained |
| Plugin, account portal, Owner PKCE/token/SSO edge | `plugin-server/` | Desktop eb9a6487; real private Operator bridge |
| Operator, accounts, fleet, device and session APIs | `operator-host/` | Desktop eb9a6487; native PG/Redis authority |
| Desktop V4 web and Tauri native | `client/desktop-v4/` | eb9a6487 includes the physically accepted 4dddf511 implementation |
| Windows C# host, tray, IPC, updater | `client/windows-native/` and native projects under `client/` | Current source preserved; locked native installer CI PASS; physical acceptance pending |
| RM V2 Windows/macOS/Linux helpers | `client/windows-native/GptOperator.RealRemoteV2/`, platform native projects | Latest selected pacing/click/cursor/lease fixes retained; older copies not overlaid |
| Long Memory/device-local sync | Agent/Operator/Plugin memory modules | Selected current implementation and source regressions |
| Project Continuity | `device-agent/project-continuity-*.mjs` and related modules | 834d4984; standalone opt-in; Windows DACL not physically verified |
| GoldABV2 Long Memory extension | `extensions/light-remote-lm-abv2/` | eb9a6487 existing0.3 bundle; integrity source contract PASS, Chrome E2E unverified |
| Separate legacy Long Memory extension | `extensions/light-remote-lm/` | 6cafb33b restored0.2 HTML/assets; archived legacy bindings, not active GoldABV2 |
| RC50 platform portability | `platform-v2/` and missing supporting files | 55429664 missing-path recovery; prototype not auto-enabled |
| SQL | `platform-v2/sql/` | Current core lock retained instead of RC50 older lock; 043 + Owner extension pinned |
| Build and governance | `deploy/unified/`, active workflows, root truth docs | New reconstruction implementation |

Full file-level origins and hashes are in `MIGRATION_PROVENANCE.json`. Old WinForms dialogs, superseded portal/team prototypes and branch-specific workflows remain recoverable from the verified archive. They are not active replacements for V4 merely because an older branch contains additional paths.

Recovery inventory: 3 Git stores; 73 primary worktrees plus 7 extra-store worktrees; 79 discovered roots fingerprinted (some paths overlap); 11 dirty primary worktrees preserved; 8 active container roots fingerprinted. Unknown runtime source hashes remain explicitly unknown rather than assigned a commit from a directory name.

All-store comparison:277 head/tag refs,145 revisions,2237 unique paths across15 component groups. Five paths only in the extra legacy RM store were reviewed and left archived in favor of current independent Agent/RM V2 lifecycle.
