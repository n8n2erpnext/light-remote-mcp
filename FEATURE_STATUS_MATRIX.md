# Feature status matrix

Current dev5/source8e0d932: full CI64 PASS9/9 and internal installer verified on ARM and locally. Seven source groups have automated acceptance. Owner physical acceptance, newly requested tray/setup redesign and protected-main promotion remain PENDING. Dev5 Lab Operator/Plugin/consent are now deployed with preserved state/processes. [Current evidence](docs/evidence/desktop-followup/ACCEPTANCE.json).

## Historical candidates and prior evidence


Current UX/source baseline:0.10.1-dev.4 at947a117, full CI45 PASS9/9. All nine Desktop screens plus login/link/confirm and consent are implemented and browser-verified with121 React/170 browser cases. Same-source internal Lab deployed. New physical Owner acceptance remains pending.

Status is per layer. IMPLEMENTED does not imply DEPLOYED, ENABLED, INTEGRATED, CI_PASS or PHYSICAL_PASS. The checkpoint and sanitized integration report provide current run evidence; this table records selected capability and remaining scope. A source regression PASS verifies its stated source invariant, not a physical platform behavior.

| Feature | UI/frontend/source | Backend/API | Existing evidence | New DEV/CI/physical | Remaining work |
|---|---|---|---|---|---|
| Device identity/enrollment | `device-agent/` | signed enrolled channel | historical/source | IMPLEMENTED; scoped DEV API PASS; native profile CI PASS; physical pending | new candidate Agent needed |
| Short ID | `lib/gold-short-id.mjs` | core043 immutable SQL identity | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | real enrolled-device exercise |
| A/B consent/approval | Desktop + Local Wall + Account | signed current-attempt/device/Owner/CSRF gates | real OAuth -> Wall/Account B -> PG grant -> MCP attach | source947a117; real backend25 + CI45 PASS; physical NOT_RUN | Owner physical B test after exact artifact install |
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
| Recovery/update/rollback | independent updater/watchdog and one primary EXE | exact pinned compatibility source/version/hash | CI41 real bridge upgrade/reinstall/forced rollback/watchdog/uninstall PASS | automated installed lifecycle PASS; physical NOT_RUN | Owner acceptance; public feed HOLD |
| Long Memory | functional native module/scope/storage/sync/lifecycle controls; immediate CAS Enable/Disable | real Agent SQLite, signed account sync/delete | first-use/schema, archive/restore and disable-retains-data integration PASS | backend25 + web115 + CI41 PASS | physical UI;100-row Desktop window, further records in Wall |
| Codex Bridge | functional module/task CRUD/runtime/login/observer/delegation UI | actual optional Agent controllers | task CAS and no process/login on screen-open regression PASS | backend25 + web115 + CI41 native PASS | physical official runtime/login/delegation acceptance |
| Owner Login | `client/desktop-v4/src-tauri/src/owner_login.rs` | Portal consent/PKCE/native token | historical physical 4dddf511 | IMPLEMENTED; scoped DEV API PASS; native profile CI PASS; physical pending | new real DEV + native artifact |
| Persistent Owner session | `client/desktop-v4/src-tauri/src/owner_login.rs` | secure native vault / rotating family | historical process cold restore | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | new native vault acceptance |
| Owner Logout | `client/desktop-v4/` | family revoke + vault clear | source | IMPLEMENTED; scoped DEV API PASS; native profile CI PASS; physical pending | real DEV revoke + native clear |
| Local Wall SSO | `client/desktop-v4/ + plugin-server/` | mTLS issuer + signed enrolled relay | source | BACKEND_ENABLED; issue DEV PASS; local wiring MISSING; physical NOT_RUN | positive candidate relay + native bootstrap |
| Native Agent IPC | current Owner/account/device-bound native command and explicit ACL | private same-user pipe/socket,32 fixed Agent actions | private transport/account-rotation denial and real backend Agent controllers PASS | CI41 native/Windows package + ARM real IPC PASS | physical Windows Owner session/IPC exercise |
| Device overview | native current-device status plus Owner inventory | current native device API + typed Owner pages | no renderer-relative URL under Tauri; old Owner rows suppressed before effects | backend25 + web115 + CI41 PASS; Lab read enabled | Owner physical authenticated GUI |
| Device link/relink | `client/desktop-v4/ + client/` | Owner/local Agent identity boundary | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | new Windows candidate |
| AI Access/pending approvals | `client/desktop-v4/` | A/B pending read/approve gate | historical pending read only | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | new native approval not inferred |
| Active grants | `client/desktop-v4/` | Owner snapshot grants page | source | IMPLEMENTED; profile CI PASS; DEV scope in report; new PHYSICAL UNKNOWN | real DEV + granted device fixture |
| Sessions/activity/jobs | real PG/Redis Owner pages, exact-local-device close/cancel | existing signed controllers and typed pages | current account/device, explicit confirmation, async refresh fences | backend typed reads + web115 + CI41 PASS | physical close/cancel and retention acceptance |
| Inventory/usage | `client/desktop-v4/` | bounded device/usage pages | source | IMPLEMENTED; scoped DEV API PASS; native profile CI PASS; physical pending | real DEV typed pages |
| Logs/settings | real Agent/Cloud/log retention/cleanup and policy state | fixed native host + Owner-bound device API | explicit Start preserves actual daemon; same-account response fences | CI41 installed/native + web115 + backend25 PASS | Owner physical acceptance; no arbitrary policy editing |
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

## Rebuild Desktop as a user workspace and fix populated approval and monitor layouts

All nine Desktop routes, Auth entry, linking, typed confirmation and browser consent: IMPLEMENTED_LOCAL_VERIFIED, native CI/artifact pending. Source/UI trust boundaries retain prior functional APIs. No new physical acceptance inferred from synthetic screenshot QA.

## Record Owner stop-build instruction and next native acceptance checklist

Fresh Moryqa Windows V3, canonical STOCK logo, Google Sans Flex design/Google Sans native, actual five-state unified tray, gentle reduced-motion-aware transitions and empty-only desktop-v4 cleanup: SOURCE_IMPLEMENTED through0397d871. CI71 prior source302c662:9/9 PASS, six native views. Final heading-margin source: BUILD_TEST_DEFERRED_BY_OWNER. Dev6 deployed/Owner physical acceptance/public release remain false.

## Plan local Memory retention, ChatGPT Claude extension and multi-provider API Worker

[API Worker / local context plan](docs/plans/LOCAL_MEMORY_EXTENSION_API_WORKER_PLAN.md): Long Memory local save/sync is Owner-reported working, dedicated encrypted relay exists; server-wide no-content-retention is NOT_ESTABLISHED due MCP exec event logging path. Extension ChatGPT manual capture/staging IMPLEMENTED_IN_SOURCE, Claude/restore NOT_IMPLEMENTED and physical Chrome acceptance NOT_RUN_THIS_TASK. Local Codex Owner supervisor IMPLEMENTED_IN_SOURCE/singleworker; metadata UX fixes, API Worker displayedrename, public MCP reasoning and Claude/Gemini/multiworker PLANNED_ONLY. No new runtime/native/provider acceptance inferred.

## Record CI84 internal installer acceptance, Lab rollout and preserved Google callback

| Capability | Current evidence | Remaining |
|---|---|---|
| Native installer/uninstaller cards/typography | CI84 six actual views PASS, margins8–9px at96DPI | Owner100/150/200% test |
| Connected tray glyph | DerivedSVG/PNG/RGBA hashes and native build PASS, #167A58 | Owner brightness acceptance |
| Unified LightRemote.exe | One-primary/migration/rollback/close-reopen/ConPTY PASS | Owner physical acceptance |
| Lab Operator/Plugin | GitHub3064f21/dev.6 deployed, public health/API PASS | Owner app integration acceptance |
| Google account login setup | Original production client/callback saved in Gold PG, fail-closed on temporary origin | Owner domain/profile/TLS rotation and real login |
| Wall SSO | Gated source/unit coverage PASS; independent flag OFF | Backend trusted-edge/native physical activation |
| RMv2 responsiveness/typing/GPU; Memory/API Worker | Research plans preserved | Separate implementation authorization |

## Record verified dev11 candidate and scoped remaining RM work

RM đã triển khai đóng phiên có xác nhận trước báo cáo, fallback45giây yên lặng, cursor Windows nguyên bản, badge/viền xanh nhẹ, worker input có thứ tự và status/cancel riêng, nhập dài bind đúng target và readback theo capability, GDI cache/ROI/frame mapping, cùng DXGI capture opt-in có fresh GDI fallback. CI chỉ chứng minh các ca trong receipt. Hai ca262K một đoạn khổng lồ classic/rich chưa đạt; ca chia đoạn được ghi riêng. Text đã vào Windows queue vẫn có thể gặp đổi focus trước khi ứng dụng xử lý; không cam kết atomic targeted typing hoặc tự replay. GPU resize/encoder/video/viewer chưa triển khai và hardware/mixed-DPI acceptance còn chờ. Ca WinForms Rich Edit262K chia đoạn cũng chưa đạt (CI116). Ca262K dương chỉ áp dụng cho Win32 EDIT thuần và bố cục được ghi trong receipt. Readback hiện đọc toàn bộ nội dung mỗi khối, chưa có tối ưu incremental range; hiệu năng tài liệu/app lớn vẫn là giới hạn phải đo riêng.
