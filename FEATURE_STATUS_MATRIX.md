# Feature status matrix

Status is per layer. IMPLEMENTED does not imply DEPLOYED, ENABLED, INTEGRATED, CI_PASS or PHYSICAL_PASS. The checkpoint and sanitized integration report provide current run evidence; this table records selected capability and remaining scope. A source regression PASS verifies its stated source invariant, not a physical platform behavior.

| Feature | UI/frontend/source | Backend/API | Existing evidence | New DEV/CI/physical | Remaining work |
|---|---|---|---|---|---|
| Device identity/enrollment | `device-agent/` | signed enrolled channel | historical/source | IMPLEMENTED; scoped DEV API PASS; native profile CI PASS; physical pending | new candidate Agent needed |
| Short ID | `lib/gold-short-id.mjs` | core043 immutable SQL identity | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | real enrolled-device exercise |
| A/B V2 consent/approval | `device-agent/ + operator-host/` | Wall/account signed routes | historical Wall physical 4dddf511 | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | new candidate signed B |
| Owner/Agent grants | `operator-host/` | native AB ledger | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | device-bound positive/negative integration |
| Session lifecycle/durable sessions | `lib/ + operator-host/` | PG receipts / Redis retained sessions | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | restart with live candidate Agent |
| Remote command | `device-agent/` | signed device command channel | historical Wall physical 4dddf511 | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | new candidate Agent |
| PTY/ConPTY | `device-agent/ + client/` | PTY bridge/native Windows | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | physical Windows ConPTY |
| Managed processes | `lib/managed-processes.mjs` | device tool dispatch | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | new Agent integration |
| Files/SCP | `device-agent/ + lib/` | device filesystem/SCP integrity | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | cross-platform integration |
| Live logs/history | `device-agent/local-wall.mjs` | bounded live/retained history | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | new deployed Wall |
| Account management | `operator-host/account-registry.mjs` | Portal + native PG | source | IMPLEMENTED; scoped DEV API PASS; native profile CI PASS; physical pending | real DEV acceptance |
| Main Device/Fleet | `operator-host/` | account-bound device APIs | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | candidate multi-device exercise |
| Policies | `device-agent/` | local effective policy enforcement | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | native platform acceptance |
| Signed device communications | `lib/ + operator-host/` | enrollment signature/freshness checks | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | candidate enrolled Agent |
| Recovery/update/rollback | `client/ + deploy/` | independent helper/transaction flow | source31f2339, CI #30 | IMPLEMENTED; actual bridge/reinstall/health-failure rollback/watchdog/uninstall CI PASS; physical NOT_RUN | Owner acceptance and signed-feed migration; pinned bridge before primary on old helpers |
| Long Memory | `device-agent/ + operator-host/` | local module/sync/delete flows | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | deployed UI state acceptance |
| Owner Login | `client/desktop-v4/src-tauri/src/owner_login.rs` | Portal consent/PKCE/native token | historical physical 4dddf511 | IMPLEMENTED; scoped DEV API PASS; native profile CI PASS; physical pending | new real DEV + native artifact |
| Persistent Owner session | `client/desktop-v4/src-tauri/src/owner_login.rs` | secure native vault / rotating family | historical process cold restore | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | new native vault acceptance |
| Owner Logout | `client/desktop-v4/` | family revoke + vault clear | source | IMPLEMENTED; scoped DEV API PASS; native profile CI PASS; physical pending | real DEV revoke + native clear |
| Local Wall SSO | `client/desktop-v4/ + plugin-server/` | mTLS issuer + signed enrolled relay | source | BACKEND_ENABLED; issue DEV PASS; local wiring MISSING; physical NOT_RUN | positive candidate relay + native bootstrap |
| Native Agent IPC | `client/desktop-v4/ + client/windows-native/` | named pipe/native binding | historical pending read 4dddf511 | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | new Windows IPC acceptance |
| Device overview | `client/desktop-v4/` | Owner snapshot | source | IMPLEMENTED; scoped DEV API PASS; native profile CI PASS; physical pending | real DEV + deployed UI |
| Device link/relink | `client/desktop-v4/ + client/` | Owner/local Agent identity boundary | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | new Windows candidate |
| AI Access/pending approvals | `client/desktop-v4/` | A/B pending read/approve gate | historical pending read only | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | new native approval not inferred |
| Active grants | `client/desktop-v4/` | Owner snapshot grants page | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | real DEV + granted device fixture |
| Sessions/activity/jobs | `client/desktop-v4/` | typed snapshot pages PG/Redis | source | IMPLEMENTED; scoped DEV API PASS; native profile CI PASS; physical pending | real DEV and retention markers |
| Inventory/usage | `client/desktop-v4/` | bounded device/usage pages | source | IMPLEMENTED; scoped DEV API PASS; native profile CI PASS; physical pending | real DEV typed pages |
| Logs/settings | `client/desktop-v4/` | native/local settings bridge | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | new Windows acceptance |
| Fleet/account screens | `client/desktop-v4/` | account/device routes | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | multi-device candidate |
| Windows tray/Open Wall/update status | `client/` | Tauri/Rust plus in-process WindowsHost | source31f2339, CI #30 | IMPLEMENTED; actual GUI/private CLR, hidden singleton and Agent restart CI PASS; physical NOT_RUN | focused Owner/account/vault/B acceptance |
| Single primary Windows executable | `client/desktop-v4/ + client/windows-native/` | fixed-path hostfxr and private .NET DLLs | source31f2339, CI #30 | IMPLEMENTED; final package/installed layout and real migration lifecycle CI PASS; physical NOT_RUN | Node/RM/helpers remain separate; feed HOLD; no existing runtime cutover |
| RM V2 | `client/ + device-agent/` | native helpers/visual lease/task flow | source/historical scoped | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | new platform acceptance |
| Project Continuity | `device-agent/project-continuity-*.mjs` | restored standalone source | RESTORED_ONLY | RESTORED_ONLY | core wiring / Windows DACL |
| Chrome LM extension | `extensions/light-remote-lm-abv2/ (existing0.3), extensions/light-remote-lm/ (restored0.2)` | restored complete bundle | RESTORED_ONLY | RESTORED_ONLY | modern Wall compatibility |
| RC50 portability | `platform-v2/` | restored prototype modules | RESTORED_ONLY | RESTORED_ONLY | active runtime wiring |
| Guest/pro-share | `platform-v2/sql/044_gold_pro_share.sql` | native Guest incomplete | MISSING | MISSING | finish native wiring before schema enable |
| macOS/Linux full packages | `client/ + deploy/` | historical build recipes/native source | UNKNOWN_NEW_PACKAGE | UNKNOWN_NEW_PACKAGE | exact-commit packaging |

Current compiled candidate: CI #30 **9/9 PASS**, source `31f23393aacb89b6d541cebb2cd0c2e1afa64538`, run42549642811. See [exact-source acceptance](docs/evidence/windows-one-primary/CI_ACCEPTANCE.json) and [primary manifest](docs/evidence/windows-one-primary/PRIMARY_EXE_MANIFEST.json). Earlier ARM backend deployment/integration evidence remains scoped to c03b50f. Per-feature completeness, physical acceptance and restored prototype wiring remain separate; see KNOWN_ISSUES.md.
