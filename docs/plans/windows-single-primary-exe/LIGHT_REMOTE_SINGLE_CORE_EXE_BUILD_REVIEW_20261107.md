# T11 — Windows build: hợp nhất executable chính

> **Xuất bản vào repo mới ngày 2026-11-08 (Asia/Saigon).** Đây là handoff thiết kế đã lập ngày 2026-11-07, chưa triển khai gộp EXE. Source triển khai tương lai lấy từ `main` của `n8n2erpnext/light-remote-mcp` (ID 1450214328), đọc `PROJECT_TRUTH.md` và `MASTER_CHECKPOINT.json` trước. Các HEAD, line anchors và trạng thái CI ngày 2026-11-07 bên dưới là bằng chứng lịch sử của repository cũ; không checkout/mirror vào các worktree ARM cũ. Yêu cầu hiện hành chỉ gộp hai EXE chính; Node và các helper vẫn được giữ riêng.

> **Phạm vi đã được Owner làm rõ sau review này:** Node và các helper được giữ riêng. Phần đề xuất nhúng Node/đổi PTY dưới đây chỉ còn là lịch sử. Kế hoạch hiện hành: [LIGHT_REMOTE_CORE_EXE_CONSOLIDATION_PLAN_20261107.md](LIGHT_REMOTE_CORE_EXE_CONSOLIDATION_PLAN_20261107.md). Các Actions/HEAD trong review cũ là bằng chứng tại thời điểm cũ.

Status: build/source review và proposal; chưa sửa build/source, chưa chạy installer.
Date: 2026-11-07, Asia/Saigon.
Scope: yêu cầu Owner chỉ có một EXE phần app chính; RM v2 và update/upgrade được tách. Không coi một bộ cài duy nhất là đã đạt một core executable.

## Build mới nhất đang làm gì

Đã truy vấn Actions đúng workflow/nhánh: Windows Tray Client run [42252132492](https://github.com/n8n2erpnext/light-remote-mcp-archive-20261108/actions/runs/42252132492), source `0f3c2ee1c826aa6a9e85a99b96811cd8cb2b2a92`, job `128009694807` SUCCESS. Đây là Windows build mới nhất tìm thấy trên `feat/desktop-v4-api-integration-20261103`; các HEAD sau đó chỉ đổi tài liệu. Logs xác nhận single-GUI-instance/tray lifecycle PASS và upload artifact `13521054354`, không kiểm chứng một core EXE vật lý.

Workflow **chủ động build hai project**:

- `.github/workflows/windows-native-client.yml:235–239`: publish `.NET GptOperator.Client.exe` và updater riêng.
- `:750–781`: build React/Tauri bằng `tauri build --no-bundle`, copy Rust binary vào `dist/windows/stage/desktop-v4/LightRemote.Desktop.exe`.
- `client/windows-native/installer/GptOperator.iss:63–68`: copy đệ quy toàn bộ stage vào app; shortcut/autostart `:74–96` trỏ Tauri nhưng không loại .NET host.
- CI `windows-native-client.yml:1007–1013` còn yêu cầu scheduled Agent task chạy **GptOperator.Client.exe --agent-host** và `runtime/node.exe` tồn tại/chạy. Vì vậy hai EXE trong ảnh là kết quả thiết kế hiện hành, không phải chỉ file cũ còn sót.

| Thành phần cài hiện tại | Vai trò đang có | Việc cần làm nếu bỏ |
|---|---|---|
| `desktop-v4/LightRemote.Desktop.exe` (~8.27MB) | React/Tauri GUI, native tray/single-instance, Owner PKCE/vault, native A/B và snapshot | Giữ làm nền host chính; không dựng thêm UI/shortcut thứ hai |
| `GptOperator.Client.exe` (~74.26MB) | Scheduled background Agent host, restart/backoff/Job Object; desktop CLI bridge; managed-process envelope; boot/selftest | Chuyển các vai trò vào main host trước khi xóa binary |
| `runtime/node.exe` (~87.00MB) | Node Agent/Wall/Long Memory/Codex orchestration | Nhúng runtime hoặc chuyển implementation nếu yêu cầu không còn Node EXE rời |
| `node-pty/.../winpty-agent.exe`, `.../conpty/OpenConsole.exe` | Helpers terminal theo backend/options/OS | Kiểm adapter thực và thay/nhúng đúng, không xóa chỉ vì thấy file |
| `realremote-v2/LightRemote.RM.exe` | RM v2 companion | Được Owner cho tách, giữ lazy lifecycle/isolation |
| `helper-candidate/LightRemote.Updater.exe`, updater độc lập, installer watchdog/uninstaller | Bootstrap/update/rollback/maintenance | Nằm trong ngoại lệ maintenance; không gộp vào app đang bị thay thế |

Các con số kích thước là file hiện tại trên Windows, không phải benchmark RAM hay bằng chứng mọi helper đang chạy.

`GptOperator.Client.csproj:16–19` đã có `PublishSingleFile=true`, nhưng chỉ đóng gói project .NET đó. Nó không liên kết PE của Rust/Tauri, Node hoặc helper thành cùng chương trình. Native DLL có thể vẫn nằm ngoài theo chế độ publish .NET; Microsoft có tùy chọn self-extract cho native library, nhưng điều đó không hợp nhất các chương trình độc lập. [Microsoft single-file deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/).

## Phương án đề xuất

**Đích cho phần core: một `LightRemote.exe`**, có các mode tách theo nhiệm vụ:

```text
LightRemote.exe                     GUI + tray + Owner native
LightRemote.exe --agent-host        Agent/Wall nền, không mở WebView
LightRemote.exe --managed-process … managed job helper theo policy
LightRemote.exe --self-test …       installed health/contract
```

Một file có thể chạy nhiều process/mode. Đây là cách giữ Agent sống sau khi đóng/thoát GUI; không buộc mọi chức năng vào một process duy nhất rồi làm GUI exit kéo chết Agent. Mode headless phải dispatch trước UI mutex/Tauri/WebView setup; mutex và IPC bound đúng user/profile/role. Tên mode là đề xuất, chưa tạo CLI implementation.

**Ưu tiên giữ Tauri/Rust làm main host.** UI React, Owner PKCE/vault và native A/B đã ở đó. Chuyển `.NET AgentHost`, allowlisted bridge, managed-process Win32 Job Object và boot/selftest thành module Rust/interop có kiểm chứng; giảm nhu cầu giữ cả runtime WinForms cho core. Đây là khuyến nghị từ cấu trúc source, không phải prototype đã compile.

Các điểm source phải thay đồng bộ:

- `unified_tray.rs:53–68` hiện tìm EXE .NET ở thư mục cha rồi spawn `--desktop-bridge`. Chuyển thành native function/IPC bound, không thêm một wrapper EXE thứ ba; tránh spawn một CLI process cho mỗi status poll.
- `Program.cs:10–13,56–60` phân vai `--managed-process`, `--agent-host`, `--desktop-bridge`; port logic trước khi retire file. `AgentHost.cs:130–150` khởi Node và đặt `LIGHT_REMOTE_MANAGED_PROCESS_HELPER` thành EXE cũ. `lib/native-process.mjs:76–79` còn gọi helper đó; phải giữ suspended-child/Job Object/process-tree semantics.
- `device-agent/install-windows-task.ps1:18,80`, installer shortcut/autostart/uninstall icon và recovery/task restoration phải trỏ main path mới.
- `LightRemote.Updater/UpdateApplier.cs:48,75,90–115,151` và selftests/ACK đang dùng tên .NET cũ. Retarget restart, stop, health, rollback và upgrade transaction cùng một lần; không giữ alias EXE cũ để làm CI xanh.

**Phần Node/PTY là một phase bắt buộc nếu yêu cầu vật lý chỉ còn một core EXE.** Chỉ port host .NET sang Rust sẽ vẫn còn `node.exe`, nên chưa đạt đích đầy đủ. Node có embedder API cho host native; cần proof-of-concept Windows với runtime ABI/build/linking, module/assets và cleanup/isolation trước khi chốt. [Node 22 embedder API](https://nodejs.org/download/release/latest-jod/docs/api/embedding.html).

Node SEA riêng chỉ gộp Agent JavaScript vào Node binary; không tự biến Tauri+Node thành cùng PE. Node22 SEA yêu cầu đóng gói script phù hợp; code `.mjs`, dynamic imports, filesystem assets và native modules phải kiểm kê. Native addons cần xem cách load thực tế; bản Node SEA mới hơn cũng mô tả trường hợp phải materialize addon ra filesystem. Không dùng khả năng phiên bản mới để tuyên bố Node22 bundle hiện tại đã hỗ trợ. [Node22 SEA](https://nodejs.org/download/release/latest-jod/docs/api/single-executable-applications.html), [Node SEA native addons](https://nodejs.org/download/release/v24.18.0/docs/api/single-executable-applications.html).

PTY hiện dùng `node-pty`1.1.0. Source installed `lib/windowsPtyAgent.js:37–50` chọn backend theo Windows build18309; bản trước ngưỡng có đường WinPTY. Nó còn `child_process.fork` worker ở dòng184. Muốn bỏ helper EXE phải có adapter tương đương hoặc same-main-exe worker mode, kiểm stdin/stdout/resize/signal/exit/cleanup và compatibility OS. Không loại backend đang được hỗ trợ chỉ để giảm số EXE.

Codex Bridge tùy chọn cũng gọi **Codex CLI ngoài process** (`device-agent/gold-codex-plus.mjs:82–91,166–169`, runtime manager `:52–66`). Nó là dependency/tool riêng, không phải GUI Light Remote thứ hai. Nếu tiêu chí đếm mọi EXE trong cả managed-tool data cũng chỉ cho RM+maintenance, cần giải quyết tích hợp Codex runtime trong kiến trúc, không âm thầm bỏ feature hoặc giấu binary vào cache rồi báo đạt. Tương tự, OS WebView/browser/shell executables không phải app-core file trong install tree.

Sidecar/bundle hoặc EXE tự giải nén giúp phân phối gọn nhưng vẫn có executable riêng lúc chạy; không được dùng kết quả đó để báo đã đạt literal-one-core-EXE nếu Owner không chấp nhận. [Tauri external binaries](https://v2.tauri.app/develop/sidecar/).

## Giữ toàn bộ tính năng: gate bắt buộc

1. Bản build phải có inventory `.exe` đệ quy trong install tree và managed caches, ghi rõ core/maintenance/RM/optional tool; CI chặn core EXE ngoài main path. Không chỉ kiểm shortcut và một cửa sổ.
2. Giữ GUI/tray singleton, Link/Relink, Short ID/Main, Owner login/restore/refresh/logout/vault, A/B riêng, Wall, LM/Codex và config JSON. Không giảm capability để vượt build.
3. Agent tiếp tục khi GUI đóng; headless restart/backoff/crash cleanup, Job Objects, durable jobs/claims, terminal/PTY/process tree không regress. Self-worker modes không được vô tình mở thêm GUI.
4. Upgrade từ package hai EXE hiện tại sang main mới: tasks/shortcuts/autostart/updater/health ACK được đổi đúng; chỉ dọn legacy app binaries sau transaction an toàn, giữ enrollment/vault/settings/LM/logs và rollback. Fresh install gọn không đủ chứng minh upgrade gọn.
5. CI Windows10/11, non-admin install, actual installed smoke, boot/restart, signed-update failure rollback, uninstall roundtrip; RM v2 và updater isolation vẫn giữ. Source tests/CI không tự đóng physical acceptance.

**Next T11-P01:** review thiết kế một host chính và scope của dependencies; prototype chuyển host/bridge .NET sang Rust trước, rồi proof runtime/PTY embedding. Chưa được ghi “toàn bộ tính năng giữ nguyên và đã một EXE” cho tới khi các gate này pass. Audit này không sửa source, build workflow, scheduled task, file cài đặt hay endpoint.

## Receipt lưu kết luận và công việc đồng thời

Đã lưu bản review này trong outputs của chat. Khi chuẩn bị append vào handoff repo, kiểm tra chống ghi đè phát hiện Desktop worktree có thay đổi của phiên khác: `device-agent/local-wall.mjs`, `device-agent/wall-ui-refinement.mjs` và test mới `deploy/scripts/selftest-goldabv2-wall-csrf-layout-t11.mjs`. Script dừng ở bước precondition trước mọi lần ghi, nên không thay Master/Worklog/checkpoint hoặc các file của phiên sửa.

Đây là review Actions/source tại mốc đã nêu, không phải prototype build hay bản sửa đóng gói. Cần tích hợp kết luận này vào cùng Living Master/Wall-Windows handoff sau khi người triển khai hiện tại hoàn tất patch có source+docs atomic, tránh một docs commit xen vào patch đang làm. Không stage/commit/push, thay file cài Windows hay chạy installer trong lượt review này.
