# T12-PLAN — Gộp hai Windows core thành LightRemote.exe

> **Xuất bản vào repo mới ngày 2026-11-08 (Asia/Saigon).** Đây là handoff thiết kế đã lập ngày 2026-11-07, chưa triển khai gộp EXE. Source triển khai tương lai lấy từ `main` của `n8n2erpnext/light-remote-mcp` (ID 1450214328), đọc `PROJECT_TRUTH.md` và `MASTER_CHECKPOINT.json` trước. Các HEAD, line anchors và trạng thái CI ngày 2026-11-07 bên dưới là bằng chứng lịch sử của repository cũ; không checkout/mirror vào các worktree ARM cũ. Yêu cầu hiện hành chỉ gộp hai EXE chính; Node và các helper vẫn được giữ riêng.

Ngày: 2026-11-07, Asia/Saigon. **Đề xuất kiến trúc và handoff; chưa triển khai.**

## 1. Yêu cầu đã chốt lại

Owner cho phép `node.exe` chạy riêng. Chỉ hợp nhất hai file:

- `desktop-v4/LightRemote.Desktop.exe`
- `GptOperator.Client.exe`

thành một file vật lý ở gốc thư mục cài đặt: **`LightRemote.exe`**. Node, RM v2, independent updater, installer watchdog, node-pty helpers và cấu trúc dữ liệu vẫn có vai trò riêng. Giữ toàn bộ tính năng hiện tại, bao gồm update/upgrade/rollback và chạy nền khi đóng UI.

Phạm vi này thay thế phần đề xuất nhúng Node, thay PTY và di chuyển Codex runtime trong `LIGHT_REMOTE_SINGLE_CORE_EXE_BUILD_REVIEW_20261107.md`. Những phần đó không cần thiết cho yêu cầu hiện tại.

**Kết luận:** phương án hẹp này hợp lý hơn và giảm đáng kể phạm vi thay đổi. Đích nên là Tauri/Rust làm `LightRemote.exe`, nhận thêm các nhiệm vụ Windows host đang nằm trong .NET. Node tiếp tục thực thi Agent/Wall và nghiệp vụ hiện có. Đây là khuyến nghị từ source review, chưa phải chứng minh bằng bản Windows mới.

## 2. Bằng chứng và giới hạn rà soát

Đã đối chiếu cả nhánh GitHub và nhánh local trên VPS, gồm Desktop V4, GoldABV2, Gold Windows/relink, updater recovery rc35–rc42, installer/release rc37–rc47, golden releases, main và các nhánh RM/cursor liên quan. Inventory ghi nhận **69 tên nhánh, 74 revision, 18 đường dẫn tích hợp trọng yếu, 86 blob khác nhau**; không thiếu Git object trong tập đã chọn. Năm tên nhánh có revision local/GitHub khác nhau được giữ riêng, không mặc định bản local là mới nhất.

Đọc sâu source hiện hành và đối chiếu biến thể theo các ranh giới: entrypoint, native tray/bridge, Owner login, supervisor, Windows Job Object, WMI boot evidence, configuration/state paths, updater, watchdog, installer, scheduled task, workflow Windows, native process và PTY. Đây là rà soát theo các điểm tích hợp của việc gộp EXE; không tuyên bố đã audit mọi file của mọi nhánh hoặc chạy lại toàn bộ lịch sử CI. Chi tiết nhánh/SHA/blob trong `LIGHT_REMOTE_CORE_EXE_BRANCH_COVERAGE_20261107.json`.

GitHub HEAD quan sát khi chụp inventory:

- Desktop: `f0767a864157bf63deabe1b91647455e6f071c51`.
- Gold mirror: `4adc25f9aa18860cfd61eec7d2a44c585019c6bd`.

Hai nhánh đang được một phiên khác sửa Wall theo T11. Full source snapshot đầu lượt đọc là Desktop `e0ed7ae9` / Gold `37b610d7`; inventory sau đó lấy thêm các revision F02/F03. Các file host đang phân tích không được giả định đã triển khai lên máy Windows. Trước khi code phải xác định lại HEAD và phiên đang sở hữu worktree.

Actions Windows mới nhất tại thời điểm đọc: [run 42339380941](https://github.com/n8n2erpnext/light-remote-mcp-archive-20261108/actions/runs/42339380941), SHA `f0767a86`, **IN_PROGRESS**. Hai run trước tại `272f8e79` / `e0ed7ae9` kết thúc failure. Không dùng run PASS cũ `42252132492` để khẳng định HEAD mới đã PASS. Không dispatch Actions trong lượt lập kế hoạch này.

## 3. Vì sao hiện có hai core EXE

Build hiện tại có chủ ý publish hai host:

| Điểm tích hợp hiện hành | Trách nhiệm phải giữ khi gộp |
|---|---|
| `client/desktop-v4/src-tauri/src/main.rs:104` và `unified_tray.rs:16,53,63,104` | Tauri window, tray, GUI singleton, Owner IPC; gọi .NET bridge để điều khiển Agent |
| `client/windows-native/GptOperator.Client/Program.cs:10,15,48,56,58,64` | Dispatch managed process, boot/selftest, agent host, desktop bridge, open Wall |
| `AgentHost.cs:18,42,148` | Scheduled host chạy Node daemon, backoff, Job Object, environment và boot recovery |
| `ManagedProcessEnvelope.cs:115` | Tạo child suspended, gắn private Job Object trước khi resume; giữ stdio và exit code |
| `WindowsBootEvidence.cs:33,79,104` | WMI LastBootUpTime có deadline, recovery file theo daemon, không biến telemetry thành bằng chứng kết thúc job |
| `TrayApplicationContext.cs:107,270,298,391,923` | Node CLI, status projection, task start/stop, restart transaction, link/poll, URL validation |
| `AppPaths.cs:5` / `ConnectionConfig.cs:8` | Install root, profile, device state và endpoint isolation Gold/GoldABV2 |
| `device-agent/install-windows-task.ps1:18,80` | Task `LightRemoteDeviceAgent` gọi `GptOperator.Client.exe --agent-host` |
| `LightRemote.Updater/UpdateApplier.cs:48,75,90,108,115,151` | Validate install, stop/recover/relaunch core, health check và rollback dùng tên .NET cũ |
| `LightRemote.Updater/Program.cs:80` / `LightRemote.InstallWatchdog/Program.cs:209` | Helper diagnostic/app identity và fallback agent host |
| `client/windows-native/installer/GptOperator.iss:56,75,82,96,663` | Icon, autostart, shortcut, postinstall, quiesce target |
| `.github/workflows/windows-native-client.yml:238,779,783,1011` | Publish .NET, stage Tauri riêng, test task phải chạy tên .NET cũ |
| `lib/native-process.mjs:76` | Agent dùng trusted managed helper để giữ process tree; tên helper đổi qua environment của host |

Line anchor là từ snapshot Desktop dùng cho review; xem lại line ở revision triển khai thực tế. [Source tree của revision Desktop đối chiếu](https://github.com/n8n2erpnext/light-remote-mcp-archive-20261108/tree/f0767a864157bf63deabe1b91647455e6f071c51).

Các nhánh cũ có supervisor ngắn hơn, thiếu recovery/backoff mới, updater chưa có rollback preflight hoặc recovery đầy đủ. Không lấy host rc35/rc39 ngắn hơn làm nền để giảm công port. Dùng Desktop integration hiện tại và bảo toàn các contract đã bổ sung ở những nhánh sau.

## 4. Kiến trúc đề xuất

```text
Light Remote MCP/
  LightRemote.exe                    duy nhất một file core
  runtime/node.exe                   giữ riêng
  agent/...                          Agent / Wall / LM / Codex như hiện tại
  realremote-v2/LightRemote.RM.exe     giữ riêng
  helper-candidate/...                updater candidate như hiện tại
  config/...                         giữ dữ liệu cấu hình và trust key
  ...                                assets, licenses, uninstaller, helpers
```

`LightRemote.exe` có nhiều chế độ chạy. Có thể xuất hiện nhiều process cùng tên, nhưng chúng chạy **cùng một file vật lý**:

```text
LightRemote.exe                       GUI + tray + Owner runtime
LightRemote.exe --agent-host          headless supervisor -> runtime/node.exe
LightRemote.exe --managed-process ... per-job containment wrapper
```

GUI và Agent tiếp tục tách vòng đời: Exit GUI/đóng Wall không dừng daemon; Stop Agent không thoát GUI; đóng host thật sự phải dọn đúng process tree nó sở hữu. Không ép toàn bộ vào một process khiến WebView crash kéo sập các job nền.

Các module Rust dự kiến: `windows_host/{dispatch,paths,agent_host,managed_process,boot_evidence,agent_cli,desktop_actions,health}.rs`. Đây là tên đề xuất, chưa tạo source. Các module worker không phụ thuộc Tauri AppHandle hoặc Owner session. CLI dispatch phải chạy trước GUI singleton, tray, WebView và Owner vault initialization; mỗi role dùng singleton phù hợp. Worker không bị GUI mutex chặn, và `--managed-process` không dùng singleton toàn cục.

Giữ React/UI và các module Rust Owner hiện hành. Chỉ chuyển phần host/headless/static bridge đang cần cho V4; không chuyển cả WinForms UI cũ, không giữ một launcher rồi giải nén/chạy EXE thứ hai.

### Các lựa chọn đã cân nhắc

| Lựa chọn | Đánh giá |
|---|---|
| **Tauri/Rust main + port host Windows hẹp** | Khuyến nghị. Giữ nguyên UI và native Owner/vault/A/B, không thêm CLR hosting, Node vẫn riêng |
| Rust main host C# class library qua hostfxr | Có đường kỹ thuật chính thức, có thể dùng làm phương án dự phòng nếu PoC port host thất bại. Phải tách headless class library khỏi WinForms, đóng gói CLR, quản lý FFI và vòng đời runtime. Không tự động biến hai project thành một binary |
| C# main + dựng lại shell WebView2/Owner bridge | Chuyển thêm UI integration và native Owner security; phạm vi lớn hơn cho codebase hiện tại |
| Đổi tên launcher, giấu/giải nén EXE còn lại | Không đạt mục tiêu chỉ còn một core executable thực tế |

[Microsoft native .NET hosting](https://learn.microsoft.com/en-us/dotnet/core/tutorials/netcore-hosting) mô tả hostfxr và delegate để gọi managed library. [Tauri project structure](https://tauri.app/start/project-structure/) mô tả desktop entrypoint/shared library; tài liệu đó không tự chứng minh một Tauri GUI nhúng vào .NET là giải pháp tương thích sẵn. Việc chọn Rust host là đánh giá kiến trúc của review này.

## 5. Contract phải bảo toàn

| Contract | Đích ở LightRemote.exe / điều kiện |
|---|---|
| Default launch / shortcut | Một GUI + một tray; lần mở tiếp theo focus cửa sổ đang có |
| `--agent-host` | Chạy nền, không mở cửa sổ/console hoặc đọc Owner vault; Node daemon, env/profile, backoff 1/2/4/8/16/30s và fresh Job Object mỗi attempt |
| `--managed-process <exe> [args...]` | Preserve argument quoting, working directory, inherited stdio, child exit status; lỗi wrapper 125/126; suspended-create → assign job → resume; fail-closed nếu attach thất bại |
| `--boot-evidence-self-test <file>` | JSON health có kết quả WMI thật, 0/1; giữ deadline/recovery/cancellation semantics |
| `--self-test-output <file>` | Giữ health JSON contract updater cần, thêm kiểm tra host mới; không tạo GUI hoặc tự enroll/connect |
| `--desktop-bridge <action>` | Có thể giữ làm compatibility/debug entrypoint theo allowlist hiện có; GUI production gọi module Rust trực tiếp để bỏ lần spawn .NET |
| `--open-wall`, `--launch`, `--background` | Xác định semantics tương thích mọi caller còn tồn tại; background không bất ngờ đưa UI ra trước. Không giữ cờ không dùng mà không có call-site inventory |
| Desktop action responses | Giữ field/status casing đang được React/tray dùng, trạng thái chưa xác minh không thành Connected/Main; 12 action đang allowlist phải có mapping |
| Node runtime | Giữ `runtime/node.exe`, Agent script, Node ABI/native addons, fork/execPath, PTY providers, LM/Codex jobs và process-policy logic |
| Managed helper env | Host đặt `LIGHT_REMOTE_MANAGED_PROCESS_HELPER` về đúng root `LightRemote.exe`; không nhận đường dẫn tùy ý từ WebView/HTTP |
| RM v2 | Giữ discovery `realremote-v2/LightRemote.RM.exe`, lazy activation, 60s idle env, per-invocation env nhất quán cho CLI/daemon |
| Data identity | Giữ `%LOCALAPPDATA%/LightRemoteGoldABV2`, `.config/gpt-operator-agent-goldabv2/device.json`, LM data, connection profile; không dùng nhầm production Gold |
| Owner identity | Giữ vault service `digital.thaiduy.lightremote.desktop.v4.owner`, account `owner_refresh_goldabv2`, OAuth client/bindings, pipe names và revocation/session fences. Binary đổi tên không phải lý do đổi identity |
| Task identity | Giữ task names và user principal; thay Execute path, không sinh task thứ hai hoặc bật thêm quyền |
| Security | Owner login / Wall session / A/B grants vẫn độc lập; không nâng quyền, không bật SSO flags hoặc đưa tokens vào JS/URL/log |

`--tray-ui-preview` là công cụ CI cho WinForms cũ, không phải một tính năng V4 phải port. Thay bằng kiểm tra/render thật của tray V4 khi cần; vẫn giữ nhánh legacy build sử dụng nó nếu chưa được Owner cho retire.

Không cần chuyển toàn bộ `AgentSupervisor.cs`: phần daemon quản lý trong WinForms legacy không phải một supervisor thứ hai cho V4. Chỉ lấy các thao tác CLI/health mà V4 còn dùng; tránh vô tình dựng hai daemon.

## 6. Điểm khó nhất: updater đang cài trên máy

**Chỉ sửa updater trong bộ cài mới chưa đủ.** Updater cũ đang chạy từ vị trí độc lập vẫn thực hiện `TryInstallAndVerifyAsync()` bằng `GptOperator.Client.exe`. Nếu installer mới chỉ cài `LightRemote.exe`, helper cũ có thể thất bại health check và rollback. Ngoài ra pipeline hiện tại chỉ promote helper mới sau khi core đã khỏe, nên không thể giả định helper mới sẽ sửa được bước kiểm tra của helper cũ đang điều khiển transaction đó.

Đề xuất đường tự động hai chặng:

1. **Bridge release:** giữ layout core hiện hành, cập nhật independent updater để hiểu layout cũ và mới; vẫn verify chữ ký, product/profile, health và rollback. Helper mới phải chạy được với cả core cũ lẫn `LightRemote.exe`. Sau core-health/promotion, xác minh chính helper mới đã active trước khi cung cấp release gộp.
2. **Release gộp:** helper đã có khả năng tương thích mới áp dụng core layout mới; health gọi `LightRemote.exe`; rollback về installer cũ và task/shortcut cũ vẫn hoạt động. Không giả vờ old helper đã được cập nhật chỉ vì candidate nằm trong thư mục cài đặt.

Manual signed installer có thể là đường nâng cấp trực tiếp riêng nếu PoC chứng minh transaction/promotion/recovery đầy đủ; không dùng thành công của manual install để khẳng định đường auto-upgrade từ helper cũ đã PASS.

Package metadata cần phân biệt layout cũ/mới trong phạm vi product/profile đã xác minh. Chỉ cho phép executable path cố định theo layout hợp lệ, không chạy một chuỗi path tùy ý trong JSON. Đổi tên main không cho phép update từ GoldABV2 sang Gold production. Feed/profile issue đã nêu trong T10 vẫn là gate độc lập; không bật generic beta feed để thử cho nhanh.

## 7. Kế hoạch thực hiện theo patch có thể review

| Patch | Công việc | Gate trước patch kế tiếp |
|---|---|---|
| P0 — Baseline | Chốt HEAD sau phiên Wall hiện tại; kiểm kê caller/CLI/JSON/stdio/data identity; ghi feature matrix và build artifact baseline | Đủ inventory các đường khởi động, update/rollback và các test hiện có; không dùng repo HEAD làm bằng chứng máy đã cài |
| P1 — Compatibility updater | Helper hỗ trợ hai core layout, health/relaunch/recovery theo layout; bridge release plan và kiểm tra product/profile | Chứng minh updater đã active, chạy được với core cũ; failpoints/rollback về helper hoặc core cũ vẫn đúng |
| P2 — Native host PoC | Dispatch sớm và port supervisor/Job Object/managed wrapper/WMI/selftests sang Rust; gọi Node hiện có | Windows thật hoặc native CI: không GUI trong worker, không phụ thuộc WebView2 đang chạy, stdio/exit code/child cleanup/recovery đúng. Chưa bỏ .NET khỏi package |
| P3 — Desktop actions | Port phần bridge cần thiết sang module Rust; UI/tray gọi trực tiếp; dùng lại Node CLI trước | Link/preview/poll/disconnect/start/stop/restart/update/open URLs giữ contract và authority; shutdown GUI không tác động jobs |
| P4 — Package switch | Stage `LightRemote.exe` ở root; cập nhật installer/task/watchdog/helper paths, icon/shortcut/autostart, CI và docs đồng bộ | Artifact V4 không có hai core cũ, có đầy đủ runtime/helpers; layout cũ/new upgrade và rollback được test trước khi promote |
| P5 — Acceptance | Full feature regression, native install/upgrade/reboot/update failpoints, Windows 10/11 physical validation, đo cold/warm/idle | Exact run/artifact/hash + phân biệt CI/physical evidence; chỉ đề nghị phát hành sau khi các gate PASS |

P2/P3 có thể review trên nhánh thử trước khi phát hành bridge; thứ tự **phát hành** vẫn phải bảo đảm updater tương thích active trước core layout mới. Không cần thêm runtime IPC server trong đợt đầu: gọi module trong GUI và Node CLI hiện có đủ để bỏ bridge .NET. Event/snapshot IPC tối ưu sau khi có baseline riêng.

P4 phải sửa cả logic theo dõi process, không chỉ replace string: UI/headless/managed wrappers nay có cùng executable path. Stop Agent chỉ dừng role/descendants nó sở hữu; full update mới quiesce toàn core. Ownership phải kiểm tra install root, user/profile, PID/creation identity phù hợp; không `taskkill /IM LightRemote.exe` toàn máy và không dừng các `node.exe` ngoài bundle.

Loại bỏ đúng hai file core cũ sau khi transaction và rollback path đã được chuẩn bị; kiểm tra không còn shortcut/task/autostart trỏ chúng. Không xóa cả `desktop-v4` đệ quy nếu chưa inventory tài nguyên cần giữ. Không xóa device/vault/LM/profile để xử lý lỗi migration.

## 8. Các thay đổi CI bắt buộc

Workflow hiện đang khẳng định layout hai EXE. Cần sửa test để kiểm chứng hành vi mới, không đơn thuần xóa assertion cũ:

- V4 stage/installed root có `LightRemote.exe`; không stage hai core cũ. Runtime/RM/updater/PTY/uninstaller EXE không thuộc điều kiện cấm này.
- Task Execute là root `LightRemote.exe --agent-host`; user principal, restart settings và không có task host trùng được xác minh.
- GUI relaunch, hide-on-close, tray owner, start/stop/restart, native boot evidence, selftest và managed-process descendants có test chạy binary thật.
- Health check của updater gọi đúng layout; migration từ old helper phải có test thất bại/hold dự kiến hoặc bridge đủ điều kiện; old core → bridge helper → new core và new core → old core rollback đều có test.
- Test kill/crash giữa các bước install/task-register/helper-promote/ack, thiếu rollback installer, WMI timeout, port bị chiếm bởi app khác, Node daemon crash và managed wrapper abort.
- Kiểm tra clean install, reinstall, upgrade giữ enrollment/vault/LM, reboot/logon restore, manual update, auto update, helper promotion failure và uninstall.
- Giữ source tests cho Owner/A/B/SSO/LM/PTY/Codex/SCP/RM, kiểm thử UI theo DPI/resize và không đánh tráo Node fixture/source regex thành native acceptance.
- Workflow dùng chung vẫn phải build Gold legacy nếu nhánh đó còn được hỗ trợ; không rename hoặc delete toàn bộ `GptOperator.Client` project cho mọi product một cách máy móc.

## 9. Tối ưu đi kèm và cách đo

Trên source hiện hành, tray poll `status` mỗi 5 giây qua `run_native()` → spawn .NET bridge → spawn Node CLI. P3 bỏ tầng .NET bridge process; giữ Node CLI để giới hạn phạm vi thay đổi. Tối ưu tiếp theo là gom các consumer status vào một snapshot có timestamp/generation, request đang chạy thì không tạo request trùng, trả unknown khi stale, dùng timeout/cancellation có giới hạn. Không thêm cached authority để suy ra Connected/Main.

Nếu sau đo đạc Node CLI polling vẫn tốn tài nguyên, đề xuất riêng typed local IPC/event feed có ACL/profile binding và snapshot authority đúng; không mở HTTP mutation mới cho đợt gộp EXE này. Dùng chung endpoint catalog theo đề xuất T10 khi công việc đó sẵn sàng, không tạo thêm một bộ URL hardcoded trong host Rust hoặc tự đổi production binding.

Đo baseline và candidate trên cùng máy: kích thước core/install, thời gian cold/warm open, idle CPU/RAM của GUI+host+Node, số lần spawn mỗi phút, restart latency và update/rollback duration. Dự kiến bỏ được self-contained .NET core host khỏi package V4 và giảm spawn trung gian; **chưa có số đo nên không cam kết giảm RAM/tăng tốc theo phần trăm**. .NET dependencies cho RM/updater vẫn giữ nếu chúng cần.

## 10. Điều kiện hoàn thành và handoff cho phiên Fix

Một core file đạt yêu cầu khi cài mới/nâng cấp đều chỉ còn root `LightRemote.exe`, không có bản sao/EXE giải nén của hai core cũ, và mọi tính năng trong ma trận đã được kiểm chứng. Nhiều process từ cùng EXE là hợp lệ; Node và helper riêng là hợp lệ.

**Nhiệm vụ tiếp theo: T12-P0, review contract và migration PoC.** Chưa phải lệnh sửa code, chạy installer hay phát hành. Khi được Owner giao thực hiện, trước hết kiểm tra worktree và các receipt T11 mới hơn; không reset/cherry-pick đè các bản Wall đang sửa.

Lượt lập kế hoạch này chỉ đọc repo/Actions và tạo tài liệu local. Không sửa source/build workflow, không cài app, không restart service, không bật flags hoặc thay grant/enrollment. Native build mới: NOT BUILT. Native/Windows acceptance cho kiến trúc này: NOT TESTED.

**Trạng thái lịch sử ngày 2026-11-07, đã được receipt xuất bản 2026-11-08 thay thế:** Repo continuity: cập nhật Master/Worklog/checkpoint và mirror **chưa thực hiện** trong lượt review này vì worktree canonical đang có phiên T11 sửa và commit liên tục (đã quan sát source dirty và HEAD thay đổi). Tài liệu local là kết quả hoàn chỉnh để review; trạng thái publish/mirror không được coi là đã xong. Khi writer T11 nhường worktree, append receipt proposal T12 và link tài liệu này, giữ rõ task triển khai nào đang active.
