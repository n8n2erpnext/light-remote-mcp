# Light Remote MCP

<p align="center">
  <img src="assets/branding/light-remote-mark.svg" alt="Light Remote MCP" width="128">
</p>

<p align="center">
  <strong>Cho ChatGPT, Codex và AI Agent làm việc trên thiết bị của bạn qua MCP — quyền quyết định cuối cùng vẫn nằm tại máy.</strong>
</p>

<p align="center">
  <a href="README.md"><b>Tiếng Việt</b></a> · <a href="README.en.md">English</a>
</p>

<p align="center">
  <img alt="Development candidate" src="https://img.shields.io/badge/candidate-0.10.1--dev.4-f59e0b">
  <img alt="CI" src="https://img.shields.io/badge/CI%20%2345-9%2F9%20PASS-2e7d32">
  <img alt="Windows" src="https://img.shields.io/badge/Windows-one%20primary%20EXE-2563eb">
  <img alt="Linux" src="https://img.shields.io/badge/Linux-x64%20%7C%20arm64-059669">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-native%20source%20tested-555555">
  <img alt="MCP" src="https://img.shields.io/badge/MCP-direct%20HTTPS-171717">
</p>

**Light Remote** là nền tảng điều khiển thiết bị từ xa dành cho AI, kết hợp **MCP qua HTTPS, phê duyệt A/B tại Local Wall, chính sách quyền áp tại thiết bị, session bền, terminal PTY/ConPTY thật, filesystem, process, file transfer và Real Remote V2**. AI có thể làm việc trên VPS, PC và các máy trong Fleet mà không cần mở inbound SSH trên từng máy đích.

**Kiến trúc hiện tại kết nối trực tiếp với Plugin/Operator do Light Remote vận hành, không còn dùng Vercel bridge.** Các file hoặc dependency Vercel lịch sử còn lưu trong repository **không** phải đường kết nối bắt buộc của sản phẩm hiện tại.

> **Trạng thái phân phối:** `0.10.1-dev.4` là **bản thử nghiệm nội bộ**, chưa có GitHub Release nhị phân công khai hoặc signed update feed cho bản này. Các bằng chứng CI không thay thế kiểm thử trực tiếp trên máy của chủ sở hữu. Xem [trạng thái phát triển](#trạng-thái-hiện-tại) trước khi cài đặt hoặc nâng cấp.

## Vì sao Light Remote khác remote shell thông thường?

- **Quyền ở đúng thiết bị:** Đăng nhập OAuth/Owner không tự tạo quyền thực thi. Agent phải được chủ máy phê duyệt A/B và vẫn bị chặn bởi local policy.
- **Không SSH inbound trên máy leaf:** Agent Windows/Linux/macOS chủ động thiết lập kênh outbound có xác thực tới dịch vụ, không để AI trực tiếp cầm SSH key của từng máy.
- **Định danh đích tuyệt đối:** Mỗi session và lệnh được ràng buộc với đúng device + Agent; thiết bị offline/deny thì báo lỗi, không âm thầm chạy trên máy khác.
- **Giữ phiên và công việc dài:** Có durable session, managed process và job/output để lấy kết quả tiếp mà không cần lặp lệnh khi HTTP timeout.
- **Điều khiển thực:** PTY trên Linux/macOS, ConPTY trên Windows, cùng Real Remote V2 để quan sát/giao tiếp với desktop thật theo quyền được cấp.
- **Quan sát và thu hồi:** Local Wall cho chủ thiết bị thấy request, activity, các session/lệnh và quyền đang có; chủ máy giữ quyền deny cuối.
- **Cập nhật có rào chắn:** Independent updater/helper và quy trình signed manifest, hash, health gate, rollback; bản dev.4 chưa được đưa vào feed phát hành công khai.

## Kiến trúc hiện tại — trực tiếp, không Vercel

```text
ChatGPT / Codex / MCP client
          |
          | HTTPS + OAuth / MCP
          v
  Public Light Remote Plugin
  /mcp (Streamable HTTP)
          |
          | private Unix socket
          v
    Light Remote Operator
    identity · grants · sessions
          |                 |
     PostgreSQL 17        Redis 8
     durable authority    coordination
          |
          | signed, enrolled outbound device channel
          v
   Exact authorized Agent / Device
   ├── Windows: LightRemote.exe + supporting runtimes
   ├── Linux Agent + Local Wall
   └── macOS Agent + Local Wall
          |
          ├── Local policy / A-B V2 / audit
          ├── Files, search, Git, exec, jobs, PTY/ConPTY, SCP
          └── Real Remote V2 · optional Long Memory / Codex
```

- Endpoint MCP công khai trong [`mcp.json`](mcp.json): **`https://light-remote.thaiduy.digital/mcp`**. Plugin phục vụ `POST /mcp` và sử dụng Stateless Streamable HTTP theo triển khai hiện tại; `GET/DELETE /mcp` không phải API session mở.
- [`plugin-server/server.mjs`](plugin-server/server.mjs) xử lý endpoint, OAuth, portal và tool exposure; [`plugin-server/operator-client.mjs`](plugin-server/operator-client.mjs) giao tiếp với Operator qua **Unix socket riêng**, không phải một Vercel hop.
- [`operator-host/`](operator-host/) giữ quyền điều phối, account, grant và session; PostgreSQL lưu trạng thái bền, Redis điều phối tạm thời.
- [`device-agent/`](device-agent/) và [`client/`](client/) xử lý kết nối Agent, Local Wall, Windows native và khả năng thực thi.
- [`config/endpoints.json`](config/endpoints.json) chứa profile/route khai báo trong package. Profile Lab và URL trong file này **không chứng minh tất cả endpoint đang public hoặc được bật ở production**.

Owner Desktop V4 là một giao diện khác của cùng hệ thống: Tauri/native vault giữ Owner login và token, xem thiết bị/trạng thái qua API có ràng buộc account; **`desktop:read` không cấp quyền Agent**. Cấu trúc nguồn và ranh giới tin cậy nằm trong [Architecture](ARCHITECTURE.md) và [Code Map](docs/project-book/LIGHT_REMOTE_CODE_MAP.md).

## Những gì AI Agent có thể làm

| Nhóm | Khả năng |
| --- | --- |
| Filesystem | List/read/write/edit/stat, tạo/chuyển/xóa file theo policy |
| Search | Tìm đường dẫn và nội dung có giới hạn, lấy kết quả theo trang |
| Git / developer | Kiểm tra source, diff, build và chạy test khi máy cho phép |
| Exec | Shell/PowerShell/zsh một lần, timeout, capability inference |
| Managed process | Spawn, stdin/stdout, đọc output theo offset và dừng có kiểm soát |
| PTY/ConPTY | Terminal tương tác thật: input, resize, signal, stop |
| SCP | Truyền file nhị phân/dung lượng lớn theo chunk, kiểm SHA-256 |
| Durable job | Tiếp tục job/output qua nhiều lời gọi, hạn chế chạy trùng |
| Fleet | Tìm/định tuyến tới đúng máy, state và policy riêng theo device |
| Real Remote V2 | Semantic/live desktop observation, thao tác UI có giới hạn và quyền rõ ràng |
| Module tùy chọn | Long Memory, Codex Bridge, activity history theo cấu hình và trạng thái triển khai |

Khả năng **có trong source** không có nghĩa mọi feature đều **đã deploy, bật mặc định hoặc vượt physical acceptance**. Xem [Feature Status](FEATURE_STATUS_MATRIX.md) và [Known Issues](KNOWN_ISSUES.md).

### PTY/ConPTY không phải `exec` giả lập

Terminal giữ phiên shell tương tác thực, hỗ trợ ứng dụng TUI, lệnh nhập nhiều bước, resize, Ctrl-C và thu hồi output. Quyền terminal được kiểm soát riêng; không mặc nhiên đi kèm quyền filesystem hay lệnh đọc thông thường.

## Local Device Wall — chủ thiết bị giữ quyền cuối

<p align="center">
  <img src="assets/screenshots/device-wall-demo.png" alt="Local Device Wall" width="760">
</p>

Local Wall là bề mặt cấp quyền và quan sát **ngay tại máy**: kết nối, A/B Pending, session, command/job, hoạt động và policy. Đóng giao diện Wall không tương đương dừng service hoặc xóa session.

<p align="center">
  <img src="assets/screenshots/permissions-demo.png" alt="Local Device Policy" width="760">
</p>

Quyền thực thi là giao của quyền máy thực sự hỗ trợ, quyền server/account cấp và **local device policy**. Local Wall có quyền từ chối cuối cùng. Bật một profile rộng không tự cấp sudo/UAC hay quyền nâng cao khác. Không gửi khóa bí mật, token Owner, opaque continuation hoặc session capability vào README, issue hay log công khai.

## Fleet Wall — nhiều máy, vẫn đúng đích

Main và Fleet hỗ trợ các máy đã enroll, online/offline state, chính sách từng máy, session/job theo exact device, quản trị quyền và các luồng cập nhật khi entitlement tương ứng cho phép. Một Agent đã được phép truy cập máy A **không tự động có quyền sang máy B**.

Khi đích offline, hết lease, bị thu hồi hoặc bị policy từ chối, operation phải thất bại có thể quan sát được — không fallback âm thầm. Fleet Wall và Device Wall là hai bề mặt khác nhau.

## Ba Helper của Light Remote

### 1. Connection Helper — A/B V2

1. Mở **Local Wall của đúng máy**, lấy **A code một lần**.
2. Gửi A qua official Light Remote plugin cho `light_remote_connection_helper`.
3. Plugin trả **B code** và trạng thái `approval_required`; chủ thiết bị xem/nhập B ở **chính Wall đã tạo A**.
4. Chủ thiết bị chọn **Approve**; Agent gọi lại Connection Helper **không lặp A code** để phục hồi đúng yêu cầu đang chờ.
5. Chỉ khi Helper trả `ready`, Agent mới làm việc bằng đúng session/device context được cấp.

A/B không phải mã đăng nhập Owner và không thể được bypass bằng OAuth. Một lần ghép nối chỉ có hiệu lực cho đúng target/Agent được phê duyệt. Không đưa continuation hay capability bí mật vào nội dung chat để chia sẻ thủ công.

### 2. Tool Helper — chọn đúng lệnh

Sau khi `ready`, Helper hướng dẫn chọn đúng công cụ: `files` cho tập tin, `search` cho tìm kiếm, `exec` cho lệnh một lần, `process`/`job` cho tác vụ dài, `terminal` cho PTY/ConPTY, `transfer` cho file lớn và `desktop` cho Real Remote. Agent không phải dùng shell cho mọi thao tác.

### 3. Updater Helper — phục hồi tách khỏi Core

Updater/helper độc lập với Core giữ đường nâng cấp/khôi phục, xác thực manifest/chữ ký và SHA-256/size, kiểm tra health trước khi chuyển phiên bản, rollback khi thất bại. **Kênh signed public cho dev.4 vẫn HOLD**; không coi các manifest Beta `0.9.x` lịch sử là feed của `0.10.1-dev.4`.

## Quick start — kết nối qua MCP trực tiếp

**Điều kiện:** Một hệ thống Plugin/Operator Light Remote hợp lệ, thiết bị đã cài Agent, tài khoản Owner và ứng dụng ChatGPT/Codex/MCP client đã kết nối official Light Remote plugin. Đây hiện là đường **internal candidate / developer**, chưa phải bộ cài production public self-host một lệnh.

### Bước 1 — xác định đúng nguồn và bản phát hành

Source chính thức: [`n8n2erpnext/light-remote-mcp`](https://github.com/n8n2erpnext/light-remote-mcp). Bản [archive](https://github.com/n8n2erpnext/light-remote-mcp-archive-20261108) chỉ để đối chiếu lịch sử; các hướng dẫn Vercel/RC26 trong archive **đã lỗi thời**.

- Windows **internal test** hiện tại: `0.10.1-dev.4` từ source `947a117`, [CI #45](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42628405851) PASS 9/9; [Actions artifact nội bộ](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42628405851/artifacts/13679554745). Đây **không** phải public Release.
- Cài mới/upgrader Windows: một primary **`LightRemote.exe`**, giữ Node, RM V2, thư viện .NET riêng và updater/watchdog riêng. Máy dùng helper cũ không tương thích phải qua [compatibility bridge](config/windows-core-migration.json); không cài đè tùy tiện.
- Linux/macOS: source native đã kiểm thử trong CI, nhưng **bộ installer đầy đủ cho source hiện tại chưa được chứng minh là phát hành**.

Đối chiếu hash/manifest trước khi chạy bất kỳ binary nào. Xem [Build and Deployment](BUILD_AND_DEPLOYMENT.md).

### Bước 2 — dịch vụ MCP/Operator

Đường triển khai trực tiếp gồm HTTPS reverse proxy → Plugin `/mcp` → private Operator Unix socket → PostgreSQL/Redis → enrolled outbound Agent. **Không cần tài khoản, project, environment variable hoặc Vercel deployment.**

Nếu tự triển khai ở DEV, trước tiên đọc [Architecture](ARCHITECTURE.md), [`plugin-server/config.mjs`](plugin-server/config.mjs), [Code Map](docs/project-book/LIGHT_REMOTE_CODE_MAP.md) và [Build/Deployment](BUILD_AND_DEPLOYMENT.md). Plugin mặc định bind localhost; chỉ reverse proxy endpoint công khai cần thiết qua HTTPS, **không public Operator socket, PostgreSQL, Redis, Local Wall hay file state/private key**. Không lấy lệnh `--vercel-team` hoặc bộ biến `VPS_MCP_*` từ archive để cấu hình bản này.

### Bước 3 — cài và link thiết bị

Cài đúng installer/candidate được chủ hệ thống cấp, link thiết bị bằng luồng Owner/device của client, xác nhận kết nối Agent và mở **Local Wall**. Windows là Desktop V4 có GUI/tray và background Agent; Linux/macOS có Agent/Wall theo gói và trạng thái hỗ trợ thực tế. Đường Local Wall thường được cấu hình trên loopback (profile hiện khai báo `127.0.0.1:5491`; Fleet `5492`), không phải endpoint để public tùy tiện.

### Bước 4 — phê duyệt ChatGPT/AI vào đúng máy

Mở official Light Remote plugin trong AI client, tạo A code từ đúng Local Wall và gửi yêu cầu. Khi nhận B, nhập vào `/approve` của **cùng** Wall; sau Approve, Agent gọi lại Helper để nhận `ready`. Từ đây có thể yêu cầu: “đọc repo và chạy test”, “kiểm tra Docker trên VPS”, “mở PTY”, “sao chép file có kiểm SHA” hoặc “quan sát ứng dụng Windows bằng Real Remote V2” trong phạm vi quyền.

### Bước 5 — thêm máy khác

Enroll và phê duyệt A/B riêng cho **mỗi máy**. Không suy diễn thiết bị khác được cấp quyền chỉ vì cùng Owner/Fleet.

## Cập nhật, phục hồi và phát hành

Cơ chế được thiết kế với signed manifests, kiểm chữ ký, SHA-256/size, health gate và rollback; native Windows migration đã có CI thực tế. Nhưng cần phân biệt:

- **Source/CI PASS:** build, contract/integration, Windows lifecycle, Linux/macOS source proof.
- **Internal Lab deployed:** Plugin/Operator nội bộ đã thử trên source xác định, không phải production/direct UAT được nâng cấp hàng loạt.
- **Owner physical:** chưa xác nhận đầy đủ cho đúng installer `dev.4`.
- **Public release/feed:** **chưa phát hành** cho `dev.4`; feed Beta `0.9.x` chỉ là tương thích/lịch sử.

Không tự áp public update manifest mới, không đổi môi trường production và không hồi sinh URL release asset cũ mà chưa được kiểm chứng.

## Bảo mật

Light Remote không biến HTTPS thành quyền `root` tự động. Các lớp quan trọng: OAuth/Owner scope tách Agent grants; phê duyệt B tại máy; signed enrolled device channel; account/device/session/Agent binding; local policy final deny; tool capability inference; exact device routing; private Operator Unix socket; signed update và rollback. Owner/agent secrets không đặt trong Git, logs công khai, browser UI hay ví dụ README.

- Local Wall SSO backend đã có bằng chứng kiểm thử nhưng **bootstrap Agent/browser đầy đủ chưa hoàn tất**; không tuyên bố feature đã sẵn sàng production.
- Guest/Pro Share, các prototype phục hồi và full installer Linux/macOS vẫn có scope chưa hoàn thiện.
- Xem [SECURITY.md](SECURITY.md), [Feature Status](FEATURE_STATUS_MATRIX.md), [Known Issues](KNOWN_ISSUES.md).

## Developer, nguồn chuẩn và checkpoint

- **Repo chính thức:** [n8n2erpnext/light-remote-mcp](https://github.com/n8n2erpnext/light-remote-mcp); SSH từ VPS-ARM: `git@github.com:n8n2erpnext/light-remote-mcp.git`.
- **Nhánh phát triển duy nhất đã được Owner phê duyệt:** `work`; `main` là baseline được bảo vệ bởi `baseline-required`. Không tự tạo nhánh, force-push hoặc tắt protection.
- **Thư mục tạo mới trên VPS-ARM:** chỉ bên trong `/home/ubuntu/n8n2erpnext/light-remote-unified-20261108/`; checkout phát triển là `implementation-20261108/single-primary-exe`. Archive/checkout conversion chỉ để tham chiếu.
- **Mỗi commit:** `MASTER_CHECKPOINT.json` + `PROJECT_HANDOFF.md` + `docs/project-book/LIGHT_REMOTE_WORKLOG.md` + generated `PROJECT_TRUTH_STATUS.json` cùng commit; chạy stamp/check gate. Không commit code/docs trước rồi ghi checkpoint sau.
- **Điểm đọc chính:** [Project Truth](PROJECT_TRUTH.md), [Project Book](docs/project-book/README.md), [Code Map](docs/project-book/LIGHT_REMOTE_CODE_MAP.md), [Handoff](PROJECT_HANDOFF.md), [Master Checkpoint](MASTER_CHECKPOINT.json), [Build/Deployment](BUILD_AND_DEPLOYMENT.md).

Kiểm tra portable (Node 22, môi trường DEV đúng dependency):

```bash
npm ci --ignore-scripts
npm run check:truth
npm run check:docs
npm test
# chỉ với fixture / host phù hợp; không phải lệnh triển khai production
```

Windows native installer và các bài kiểm thử thực tế phải build từ exact clean GitHub commit qua GitHub Actions; không suy diễn từ chạy Node tests trên VPS-ARM.

## Trạng thái hiện tại

| Hạng mục | Trạng thái và phạm vi bằng chứng |
| --- | --- |
| Windows Desktop V4 | `0.10.1-dev.4`, **1 primary LightRemote.exe**, internal build/installed lifecycle CI PASS |
| CI / nội dung | [#45](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42628405851) **9/9 PASS**: React 121, consent/token 36, browser 170, backend private 25, native Windows migration/rollback |
| Internal Operator + Plugin | Same-source `947a117` đã triển khai và kiểm health trên môi trường Lab có kiểm soát |
| Agent PTY/Fleet/Real Remote | Có implementation/source và bằng chứng từng phạm vi; physical cross-device cho candidate hiện tại cần kiểm riêng |
| Owner physical dev.4 | **PENDING** |
| Mac/Linux current installers | **NOT BUILT/NOT VERIFIED** (native source tests PASS) |
| Public GitHub Release / signed update feed dev.4 | **HOLD / NOT PUBLISHED** |
| Local Wall browser SSO, Guest, một số module phục hồi | **INCOMPLETE** |

Đọc [Acceptance dev.4](docs/evidence/desktop-user-experience/ACCEPTANCE.json) và [Build manifest](docs/evidence/desktop-user-experience/BUILD_MANIFEST.json) để xem chứng cứ đúng source; không dùng bằng chứng release archive RC26 như chứng cứ cho bản này.

## License

Apache-2.0. Xem [LICENSE](LICENSE), [NOTICE](NOTICE), [THIRD_PARTY_DISTRIBUTION_NOTICES.md](THIRD_PARTY_DISTRIBUTION_NOTICES.md).
