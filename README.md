# Light Remote MCP

<p align="center">
  <img src="assets/branding/light-remote-mark.svg" alt="Light Remote MCP" width="128">
</p>

<p align="center">
  <strong>Cho ChatGPT Web và AI làm việc trực tiếp trên máy của bạn qua HTTP — không cần mở SSH inbound cho từng máy.</strong>
</p>

<p align="center">
  <a href="README.md"><b>Tiếng Việt</b></a> · <a href="README.en.md">English</a>
</p>

<p align="center">
  <img alt="Beta" src="https://img.shields.io/badge/beta-v0.9.0--rc.26-f59e0b">
  <img alt="Windows" src="https://img.shields.io/badge/Windows-x64-2563eb">
  <img alt="Linux" src="https://img.shields.io/badge/Linux-x64%20%7C%20arm64-059669">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Intel%20%7C%20Apple%20Silicon-555555">
  <img alt="Transport" src="https://img.shields.io/badge/device%20transport-outbound--first-171717">
</p>

**Light Remote MCP** là một lớp remote execution có kiểm soát dành cho ChatGPT Web, Agent và các mô hình AI khác. Thay vì để AI SSH trực tiếp vào từng VPS/PC, Light Remote đưa filesystem, process, terminal PTY/ConPTY, Git, Docker, system services và nhiều thao tác infra qua một luồng HTTP được gắn đúng **device + session + Agent + policy**.

Mục tiêu thực tế: thay phần lớn workflow “mở SSH rồi thao tác tay” bằng một kết nối AI có thể audit, cấp quyền theo máy, giữ session bền và thu hồi được.

> **Beta:** `0.9.0-rc.26` là release candidate để test. Hãy bắt đầu với quyền thấp trên máy không critical trước khi bật terminal, sudo/UAC, package manager hoặc system-service permissions.

## Vì sao Light Remote khác một remote shell thông thường?
- **Không cần mở inbound SSH trên leaf client.** Windows/Linux/macOS Agent giữ outbound device channel tới Hub.
- **Không cần mở terminal để giữ kết nối.** Windows chạy background Agent sau tray, Linux chạy systemd, macOS dùng launchd; đóng PowerShell/SSH/browser không làm service biến mất.
- **PTY/ConPTY thật.** Agent có thể mở shell tương tác, gửi Ctrl-C, resize terminal, chạy installer/TUI/curses và giữ terminal theo session.
- **Local Wall là quyền lực cuối ở máy.** Bạn thấy session, job, command/output, PTY, A/B pairing và tự chọn profile quyền `Safe / Developer / Infra / Full / Custom`.
- **Fleet không được phép “nhảy máy”.** Mỗi job luôn gắn exact device; máy đích offline/denied thì fail, không fallback sang máy khác.
- **Signed update + rollback.** Manifest update được ký, artifact kiểm SHA-256/size, Updater Helper độc lập với Core và có health gate trước khi commit phiên bản mới.
- **Agent được hướng dẫn dùng tool đúng loại.** Connection Helper lo pairing/context; Tool Helper chỉ cho Agent khi nào dùng filesystem, search, process, PTY, exec, SCP hoặc durable job thay vì shell bừa.

## Kiến trúc ngắn gọn

```text
ChatGPT Web / Agent / AI model
            |
            | HTTPS
            v
      Vercel bridge
            |
            v
   Light Remote Server / Hub
     session · policy · audit
            |
     +------+------+------+
     |             |      |
   Main         Windows  Linux/macOS
   Host          leaf      leaf
```

**Vercel chỉ là bridge HTTP mỏng.** Hub bền vững vẫn chạy trên Linux Server/VPS của bạn. Device client kết nối outbound về Hub; Vercel không giữ private device key hay update signing private key.

## Những thứ Agent có thể làm
| Nhóm | Khả năng hiện có |
| --- | --- |
| Filesystem | đọc/ghi/edit/stat/list/mkdir/copy/move/delete bằng structured tool |
| Search | tìm file hoặc nội dung đệ quy, có paging, không cần `grep/find` cho mọi việc |
| Git / build | làm việc với repo, diff, branch, build và test trong policy cho phép |
| Exec | lệnh shell/PowerShell/zsh một lần, có timeout và capability inference |
| Process | process dài hạn có stdin/stdout, đọc output theo offset, stop độc lập |
| Terminal | PTY trên Linux/macOS, ConPTY trên Windows; input/output/resize/Ctrl-C/terminate/kill |
| File transfer | SCP-style upload/download file lớn hoặc binary, kiểm SHA-256 từng chunk và toàn file |
| Infra | Docker, LXD, systemd, Windows Services/Registry/Tasks/Firewall, macOS launchd/log tùy platform và policy |
| Durable work | job có thể tiếp tục chạy qua nhiều HTTP call; output được lấy tiếp thay vì ép vào một response |
| Multi-device | Fleet Wall, Main device, leaf routing, per-device policy và update orchestration khi entitlement cho phép |

### PTY/ConPTY: khi Agent cần một terminal thật

Light Remote không giả lập terminal bằng `exec`. `terminal-*` tạo một PTY/ConPTY thật, giữ ownership theo account/device/session/Agent và hỗ trợ:

```text
start → input → output → resize → signal → list → stop
```

Vì raw terminal chạy với quyền của service account và không thể inference từng dòng input như `exec`, capability `terminal` **không nằm trong Safe/Developer mặc định**. Bạn phải chủ động bật nó bằng `Infra`, `Full` hoặc `Custom` trên Wall.

## Device Wall — quyền và lịch sử nằm ở phía bạn

![Light Remote Device Wall demo](assets/screenshots/device-wall-demo.png)

Device Wall là control/observer surface cục bộ của **một máy**. Nó hiển thị trạng thái cloud, lease, session lanes, Agent, cwd, command/output, PTY operation và live operator stream. Wall có thể đóng mà không dừng service, cloud lease, Agent session hay durable job.

### Local Device Policy
![Light Remote Local Device Policy demo](assets/screenshots/permissions-demo.png)

Policy được áp theo nguyên tắc fail-closed:

```text
Main device = capabilities máy hỗ trợ ∩ Local Wall policy
Fleet leaf  = capabilities máy hỗ trợ ∩ server-approved policy ∩ Local Wall policy
```

Local Wall luôn giữ quyền **deny cuối cùng**. `Infra` không tự động đồng nghĩa với sudo/UAC; các quyền nâng cao vẫn phải được cấp riêng.

## Fleet Wall — nhiều máy, vẫn giữ exact target

Khi Fleet entitlement được bật, một Main device có thể quản lý nhiều leaf device trong cùng account. Fleet cung cấp:

- danh sách device và online/offline state;
- Main-device authority và Fleet component riêng;
- session/job routing theo exact `deviceId/nodeId`;
- policy của từng leaf và khả năng thu hồi device;
- `Update all current clients` qua signed client-update channel;
- không tự chuyển job sang máy khác nếu leaf đang offline, draining hoặc bị deny.

Fleet Wall là một **signed component** độc lập. Version Fleet, Core và branding không bị trộn làm một; updater chỉ nhận component hợp lệ, không sidegrade/rollback tùy ý.

## Ba Helper mà người dùng/Agent sẽ gặp

### 1. Connection Helper

Connection Helper biến việc kết nối ChatGPT thành flow A/B ngắn thay vì phải đưa token dài cho người dùng:

1. Local Wall tạo **A code** ngắn hạn.
2. ChatGPT/Agent gửi A vào `connection-helper` qua Vercel.
3. Server trả **B approval** cho đúng Wall đã tạo A.
4. Chủ máy kiểm tra và bấm Approve B.
5. Agent poll lại, nhận `READY`, exact device/session context và một opaque client capability riêng tư.
Opaque client/continuation không nên được echo lại cho người dùng. Mỗi device bổ sung phải được pair độc lập.

### 2. Tool Helper

Ngay sau `READY`, Agent nạp Tool Helper. Helper mô tả platform, shell modes, workspace và canonical tool contract để Agent chọn đúng thao tác:

- `fs` thay vì shell cho file/text operations;
- `search` thay vì tự grep toàn repo;
- `terminal-*` khi thực sự cần PTY/ConPTY;
- `process-*` cho process dài hạn nhưng không cần TTY;
- `exec` cho one-shot shell work;
- `scp` cho file lớn/binary;
- `job/output` khi công việc kéo dài hơn một HTTP response.

Tool Helper cũng giữ exact `deviceId + sessionId + agentId` để giảm lỗi “đang làm máy A nhưng lệnh rơi sang máy B”.

### 3. Updater Helper

Updater Helper chạy độc lập với Core. Khi có bản mới, nó kiểm signed manifest, SHA-256/size, stage Core mới, health-check rồi mới commit. Nếu health fail, updater có đường rollback thay vì để một bản update hỏng tự cắt luôn khả năng cứu máy.

## Quick start cho người ít kinh nghiệm

Bạn cần:

- một tài khoản GitHub;
- một tài khoản Vercel;
- một VPS Linux x64 hoặc arm64 làm **Server/Hub**;
- một domain/subdomain HTTPS trỏ tới MCP gateway của VPS;
- ít nhất một client Windows/Linux/macOS;
- ChatGPT Web hoặc một AI client có thể gọi bridge HTTP.

> Luồng đơn giản nhất để bắt đầu là **Linux VPS làm Hub + Vercel làm bridge + Windows làm client**.

### Bước 1 — tải bản Beta từ Releases
Mở trang [GitHub Releases](https://github.com/n8n2erpnext/light-remote-mcp/releases) và chọn release candidate mới nhất. Với `v0.9.0-rc.26`, các file chính là:

- Hub Linux x64: `Light-Remote-MCP-Server-Linux-x64-0.9.0-rc.26.tar.gz`
- Hub Linux arm64: `Light-Remote-MCP-Server-Linux-arm64-0.9.0-rc.26.tar.gz`
- Windows full installer: `Light-Remote-MCP-Setup-x64-0.9.0-rc.26.exe`
- Windows compact installer: `Light-Remote-MCP-Compact-Setup-x64-0.9.0-rc.26.exe`
- Linux client: `.deb` hoặc `Light-Remote-MCP-Client-Linux-*.tar.gz`
- macOS: `Light-Remote-0.9.0-rc.26-*.pkg`
- Vercel bridge exact-release bundle: `Light-Remote-MCP-Vercel-Bridge-0.9.0-rc.26.tar.gz`
- checksum: `SHA256SUMS.txt`

Nếu chỉ muốn dùng bình thường trên Windows, chọn **full installer**. Compact installer phù hợp khi muốn bootstrap nhỏ hơn và dùng runtime cache.

### Bước 2 — dựng Linux Server / Hub

Giải nén đúng server bundle trên VPS. Ví dụ arm64:

```bash
mkdir -p ~/light-remote && cd ~/light-remote
tar -xzf Light-Remote-MCP-Server-Linux-arm64-0.9.0-rc.26.tar.gz
cd package
```

Hub yêu cầu Docker Compose v2. Trên Debian/Ubuntu có thể để installer cài dependency bằng `--install-deps`.

Bạn cần một URL HTTPS công khai, ví dụ `https://mcp.example.com`, reverse-proxy tới MCP listener local của Hub. Có thể dùng Caddy, Nginx, Cloudflare Tunnel hoặc reverse proxy bạn đang quen dùng; Light Remote không tự public Wall ra Internet.
Cài Hub bằng user thường của VPS (không dùng `root` làm executor). Ví dụ user `ubuntu`:

```bash
sudo ./install.sh \
  --user ubuntu \
  --vercel-team YOUR_VERCEL_TEAM_SLUG \
  --vercel-project light-remote-mcp \
  --public-mcp-url https://mcp.example.com \
  --install-deps
```

Installer sẽ tạo service, state/config riêng và in ra một dòng **`Vercel OPERATOR_PUBLIC_KEYS_JSON value:`**. Copy nguyên JSON public đó để dùng ở bước Vercel. Private operator key không rời Hub.

Mặc định:

```text
MCP listener  127.0.0.1:8080
Wall          127.0.0.1:8081
Server files  /opt/light-remote-mcp/server
Config        /etc/light-remote-mcp
State         /var/lib/light-remote-mcp
```

Với Wall ở VPS từ xa, giữ nó private. Hai cách dễ hiểu:

- dùng VPN như NetBird/Tailscale và đặt `--wall-bind <VPN_IP> --wall-url http://<VPN_IP>:8081`; hoặc
- giữ `127.0.0.1:8081` và mở SSH local-forward khi cần approve: `ssh -L 8081:127.0.0.1:8081 ubuntu@YOUR_VPS`.

Không cần public Wall ra Internet chỉ để Light Remote hoạt động.

### Bước 3 — deploy Vercel bridge
Cách ít kỹ thuật nhất là fork repo này vào GitHub của bạn rồi import fork đó vào Vercel:

1. Trong Vercel chọn **Add New → Project**.
2. Import repo `light-remote-mcp` vừa fork.
3. Giữ Root Directory ở repository root; không cần đổi framework preset đặc biệt.
4. Thêm 4 environment variables cho cả **Production** và **Preview**:

```text
VPS_MCP_BASE=https://mcp.example.com
VPS_MCP_URL=https://mcp.example.com/mcp
VPS_MCP_AUDIENCE=https://mcp.example.com
OPERATOR_PUBLIC_KEYS_JSON={JSON public mà Hub installer vừa in ra}
```

5. Deploy và ghi lại URL Vercel, ví dụ `https://your-light-remote.vercel.app`.

`YOUR_VERCEL_TEAM_SLUG` và tên project phải khớp với những gì đã truyền cho Server installer; Hub dùng Vercel OIDC để kiểm tra caller chứ không tin mọi request Internet.

Nếu không muốn fork toàn repo, có thể tải `Light-Remote-MCP-Vercel-Bridge-0.9.0-rc.26.tar.gz` từ Releases và deploy exact bundle đó. Chi tiết kỹ thuật nằm trong [`deploy/vercel/README.md`](deploy/vercel/README.md).

### Bước 4 — cài client

#### Windows x64 — đường dễ nhất

1. Tải `Light-Remote-MCP-Setup-x64-0.9.0-rc.26.exe` và chạy installer.
2. Mở Light Remote MCP.
3. Vào **Server settings…** và điền:

```text
Vercel bridge URL: https://your-light-remote.vercel.app
Server / Hub URL:  https://mcp.example.com
```

4. Bấm **Enroll device**. App sẽ tạo code và tự mở browser tới trang approve.
5. Đăng nhập/approve đúng device đang hiển thị.
6. Khi app báo linked, bật **Connect** nếu chưa tự chuyển sang Connected.

Sau đó có thể đóng cửa sổ app. Tray/background Agent tiếp tục chạy; bạn không phải giữ PowerShell hay terminal mở.

#### Linux x64 / arm64

Tải `install-linux-client.sh`, rồi chạy với URL Vercel và Hub của bạn:

```bash
chmod +x install-linux-client.sh
./install-linux-client.sh \
  --base-url https://your-light-remote.vercel.app \
  --hub-url https://mcp.example.com
```

Không truyền `--bundle` thì installer tự lấy signed Beta manifest, verify chữ ký, chọn đúng x64/arm64, kiểm SHA-256/size rồi cài. Khi thiết bị chưa được enroll, installer sẽ bắt đầu flow approve ngay trong lần cài đầu.

Xong có thể đóng terminal: `systemd` giữ Agent luôn sống, update availability được kiểm định kỳ và Local Wall mặc định ở `http://127.0.0.1:5491/`.

#### macOS Intel / Apple Silicon

Tải `.pkg` đúng kiến trúc (`x86_64` hoặc `arm64`), cài package rồi dùng menu bar của Light Remote: **Sign in / Link device… → Open Local Wall → Connect**.

Beta package macOS có thể phụ thuộc external Apple signing/notarization credentials của release pipeline. Nếu macOS báo package không được tin cậy, hãy kiểm checksum/release provenance trước; không nên tắt Gatekeeper chỉ để ép cài một binary bạn chưa xác minh.

### Bước 5 — cho ChatGPT Web kết nối tới đúng máy
Trong cuộc chat có connector Vercel đã kết nối, mở **Local Wall** của đúng máy bạn muốn cho Agent dùng, bấm hiển thị/copy **A code**, rồi gửi nguyên capsule mà Wall tạo cho ChatGPT. Nội dung có dạng:

```text
Light Remote connection request
A code: ABCD-EFGH
Agent: use @Vercel and action=connection-helper. First call payload {aCode,agentId,label}; do not enumerate devices and do not send client on first pairing. Follow helper.nextAction/helper.nextPayload. Keep continuation/client private.
```

Agent phải đi theo response của Connection Helper thay vì tự đoán protocol:

1. A hợp lệ → server tạo request và trả **B code / approval_required**.
2. Trên **chính Local Wall đã tạo A**, mở **Approve B**, nhập B và kiểm tra label Agent.
3. Bấm **Approve**.
4. ChatGPT gọi lại `connection-helper` bằng `helper.nextPayload` cho tới khi nhận `READY`.
5. Sau READY, Agent giữ opaque client ở nội bộ, nạp `tool-helper` và dùng exact context được trả về.

Từ đây bạn có thể nói tự nhiên như: “vào repo này xem test fail”, “kiểm Docker trên VPS”, “mở terminal chạy TUI”, “copy file này sang máy Windows”, hoặc “theo dõi process build”. Agent sẽ chọn tool phù hợp theo Tool Helper và quyền bạn đã bật trên Wall.

> **Không gửi opaque client/continuation lên chat để copy tay.** Đây là capability nội bộ ngắn hạn dành cho Agent runtime.

### Bước 6 — thêm máy thứ hai

Cài Light Remote trên máy mới, enroll/Connect nó, rồi tạo **A code riêng trên Wall của máy đó** và pair A/B lại. Không có pre-auth fleet discovery: một Agent chỉ thấy các device đã được owner cho phép vào chính Agent client đó.
## Cập nhật và Force Update

Client dùng signed Beta channel trong `channels/beta/`. Một update chỉ được chấp nhận khi manifest có chữ ký hợp lệ, version không rollback/sidegrade trái policy, artifact đúng HTTPS + SHA-256 + size và Core mới vượt health gate.

- Local Wall có **Check now / Update now** khi client dùng independent updater.
- Account/Fleet control plane có thể gửi **Force update** tới client quá cũ qua helper lane đã xác thực.
- Windows/Linux/macOS giữ updater độc lập với Core để một Core hỏng không tự phá đường cứu hộ.
- Server/Hub là deployment plane riêng; Wall của server không tự kéo client package vào Host.

## Mô hình bảo mật

Light Remote không biến HTTP thành một `ssh root` không kiểm soát. Các lớp chính gồm:

- Vercel OIDC xác thực bridge được Hub tin cậy;
- device identity Ed25519 và signed heartbeat/outbound channel;
- A/B pairing ngắn hạn, one-time và bound vào đúng device/connection;
- session/job ownership theo account + device + Agent;
- capability inference ở device trước khi spawn;
- local policy luôn có quyền deny cuối;
- PTY/ConPTY cần capability riêng;
- private device key và update-signing private key không đi vào client payload/Vercel/GitHub Actions;
- signed update manifest + artifact hash/size + rollback.

Xem [`SECURITY.md`](SECURITY.md) trước khi public Hub/Wall hoặc cấp quyền nâng cao.
## Cho developer và tester

Public `main` giữ code/release contracts sạch; lịch sử handoff/plan trước Beta được đóng băng ở branch [`before-beta`](https://github.com/n8n2erpnext/light-remote-mcp/tree/before-beta).

- Hướng dẫn phát triển/test: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- Vercel bridge: [`deploy/vercel/README.md`](deploy/vercel/README.md)
- Host executor: [`operator-host/README.md`](operator-host/README.md)
- Signed Beta channel: [`channels/beta/README.md`](channels/beta/README.md)
- Release notes: [`docs/releases/`](docs/releases/)

Quick validation:

```bash
npm ci
npm test
# chỉ chạy trên Linux host thật có systemd/runtime tương ứng
npm run test:host
```

## Trạng thái Beta

`v0.9.0-rc.26` là prerelease Beta hiện tại. Windows x64, Linux x64/arm64, macOS Intel/Apple Silicon, Linux Server và Vercel bridge đều có build lane riêng; update channel active hiện trỏ tới RC26.

Light Remote vẫn là phần mềm pre-stable: hãy test với policy thấp trước, backup dữ liệu quan trọng và chỉ bật terminal/sudo/UAC/system-service permissions khi bạn hiểu phạm vi quyền của Agent.

## License

Apache-2.0. Xem [`LICENSE`](LICENSE), [`NOTICE`](NOTICE) và [`THIRD_PARTY_DISTRIBUTION_NOTICES.md`](THIRD_PARTY_DISTRIBUTION_NOTICES.md).
