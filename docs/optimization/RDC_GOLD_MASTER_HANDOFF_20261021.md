# MASTER HANDOFF — Light Remote Gold / RDC Optimization / G3

> **LIVE UPDATE 2026-10-21 AFTER THIS HANDOFF WAS AUTHORED:** See [RDC_GOLD_G3_WINDOWS_453_AND_PROMOTION_20261021.md](./RDC_GOLD_G3_WINDOWS_453_AND_PROMOTION_20261021.md). Gold LXD current installed candidate is now `15eed24fa400feccfb6156df7959c78a8aa437af`, not `a74ec1b`; Operator source parity TRUE and 5/5 active after stable 10-sample cutover. Windows #453 CI artifact hashes PASS, but actual owner Windows remains old/no Executor probe because installer Task Scheduler admission returned `target_node_capability_missing` before job creation. Strict OFF, explicit ExecutorReady 1/2, G3 BLOCKED; G4 not open. Sections below are the **historical pre-promotion snapshot** and must not override this latest status.
**Ngày lập:** 2026-10-21 (Asia/Ho_Chi_Minh)
**Mục tiêu:** Phiên ChatGPT kế tiếp kết nối đúng thiết bị, kiểm tra trạng thái thật và tiếp tục triển khai G3 ngay. Đây là handoff vận hành + code + UAT, không phải bản kế hoạch trừu tượng.
**Trạng thái chuẩn:** **G3 IN PROGRESS — BLOCKED_EXECUTOR_EVIDENCE (1 legacy Windows Agent)**; **chưa mở G4**. Production không thay đổi.

> **START HERE:** Đọc tài liệu này, `docs/optimization/RDC_HANDOFF_CURRENT.md`, `docs/optimization/RDC_LIGHT_REMOTE_GOLD_MASTER_PLAN.md`, sau đó chạy checklist ``Preflight`` bên dưới. Không suy luận rằng một workflow PASS nghĩa là đã cài lên Windows của owner. Không tự bật strict admission khi còn Agent `executorReady=null`.

## 1. Nguồn chân lý và checkpoint

| Loại | Canonical |
|---|---|
| Repo | `n8n2erpnext/light-remote-mcp` — https://github.com/n8n2erpnext/light-remote-mcp |
| Branch **duy nhất được sửa** | `feature/light-remote-gold-rebuild-20261018` |
| Gold worktree trên VPS-ARM | `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/light-remote-gold-rebuild-20261018` |
| HEAD trước khi ghi handoff | **`39a04e20c12c612113a76e700d9e892e78560f8b`**; khi đọc ở phiên kế tiếp phải tự xác minh HEAD mới vì commit handoff sẽ đẩy thêm |
| Source **thực sự cài trong Gold LXD** | **`a74ec1b2203da16ed2469f137684246e35a76ff5`** (versioned candidate). KHÁC branch HEAD |
| Source gần nhất thêm Fleet compatibility UI và Win installed probe | `eca1f98e8be492c34da407dc938fd084f6fb2873` |
| Commit cập nhật handoff/CI trước phiên này | `39a04e20c12c612113a76e700d9e892e78560f8b` |
| G Plan gốc | [`RDC_LIGHT_REMOTE_GOLD_MASTER_PLAN.md`](./RDC_LIGHT_REMOTE_GOLD_MASTER_PLAN.md) |
| Handoff rollup lịch sử | [`RDC_HANDOFF_CURRENT.md`](./RDC_HANDOFF_CURRENT.md) — có nhiều dòng `LATEST` cũ, đọc ĐẦU file |
| Bản handoff này | `docs/optimization/RDC_GOLD_MASTER_HANDOFF_20261021.md` |
| Chủ trương owner | Thực thi batch đủ lớn, code và UAT thật trên Linux Server Gold; Windows và macOS/Linux Desktop không được bỏ quên; ghi commit + handoff; không test bất tận hay đánh tráo mock thành nghiệm thu |

**Git hygiene:** Bốn mục untracked đã tồn tại từ trước trên worktree, KHÔNG `git add -A`, xóa hoặc sửa vô ý: `deploy/gold-uat/`, `deploy/scripts/check-gold-db.mjs`, `deploy/scripts/uat-gold-account-device.mjs`, `deploy/scripts/uat-gold-http-api.mjs`. Chỉ stage file thuộc công việc và giữ nguyên main/production.

## 2. Các môi trường, thiết bị và ranh giới

### 2.1 Gold UAT độc lập — VPS-ARM / LXD

- VPS-ARM là thiết bị chính đã A/B-authorize cho **official Light Remote** (không phải Gold plugin), thường được gọi `direct-arm-local`; Linux ARM64.
- Container **`light-remote-gold-uat`**, IP private tại thời điểm bàn giao `10.192.135.61`; entry bằng `lxc exec light-remote-gold-uat -- ...` từ VPS-ARM. Không phải production.
- PostgreSQL **17** `light_remote_gold_dev` là nghiệp vụ canonical/relational; Redis **8** ephemeral. Không thay bằng JSON/SQLite snapshot. Có file JSON identity/local config vận hành, không được nhầm với business database.
- Systemd 5 thành phần đã kiểm tra active gần nhất: `postgresql@17-main`, `redis-server`, `light-remote-gold-operator`, `light-remote-gold-plugin`, `light-remote-gold-wall`.
- Gold Operator IPC Unix socket: `/run/light-remote-gold-uat/operator.sock`, route `/v1/fleet` (HTTP 200 ở lần kiểm tra gần nhất).
- Public **Gold-only**: `https://gold.light-remote.thaiduy.digital` (Account Portal `/account`). Plugin Gold thường listen `5583`; Local Wall `5491` và Fleet Wall `5492`. Xác nhận lại unit/net listener trước thao tác.
- Old install giữ nguyên dưới `/opt/light-remote-gold-uat`; currently ACTIVE CANDIDATE dưới `/opt/light-remote-gold-uat-candidates/a74ec1b2203da16ed2469f137684246e35a76ff5`. Systemd drop-ins `90-g3-candidate.conf` chọn candidate. **Không copy file đè nóng lên live process**.
- Gold local Wall trong container (Linux ARM64) chạy `device-agent/operator-agent.mjs daemon` từ candidate, `executorReady=true` ở các lần đo trước. Đừng nhầm `operator-agent.mjs` CLI default (status) với daemon mode.

### 2.2 Windows Gold physical test Agent

- **`DESKTOP-VA16D27`**, Windows x64, đã có A/B authorization trong plugin `Light_Remote_Gold`, cùng Gold UAT account.
- Source thực tế đang cài lúc kiểm tra: `0.9.0-rc.49` **cũ**, SHA256 của installed `operator-agent.mjs`: **`D0B81354D7ED9FD6F826EA547851BFBBC2804C1A1F9F603F80B3A45998722C5A`**. Có daemon PID qua Task Scheduler/runtime, nhưng **KHÔNG CÓ** `agent\lib\executor-readiness-probe.mjs` trong bản cài.
- Installed root Windows: `%LOCALAPPDATA%\Programs\Light Remote MCP`. Runtime `runtime\node.exe`; Agent `agent\device-agent\operator-agent.mjs daemon`; module mới cần là `agent\lib\executor-readiness-probe.mjs`.
- `rc.49` là **version label**, không chứng minh source parity. Cần kiểm file/module/hash và Fleet evidence sau nâng cấp.
- Windows Agent hoạt động/online nhưng Operator thấy `executorReady=null`. **Chưa cài artifact #453 lên máy owner**. Đừng nói đã triển khai.

### 2.3 Protected production

- Production `light-remote-direct`, plugin, site production, Paddle Live và các máy khác tuyệt đối không bị sửa, restart, migrate hoặc quảng bá Gold update.
- Không tắt A/B, local policy cuối, OAuth scope, pairing, consent/lease, capability admission, NetBird/Firewall.
- Platform refusal trước khi công việc được admit ≠ lỗi Linux/sudo/Operator. Không tìm wrapper/PT​​Y/route thay thế để lách từ chối an toàn.

## 3. Nghiệm thu đã đạt — phân biệt source CI, staged LXD, live service

### G0, G1, G2

- **G0:** Baseline/research & gap matrix DONE; pin RDC reference và Light Remote source, có mô tả objective và measured tests. Links: [Master Plan](./RDC_LIGHT_REMOTE_GOLD_MASTER_PLAN.md), `RDC_FEATURE_GAP_MATRIX.md`.
- **G1:** Có điều tra lớp từ chối platform vs device, metadata/error taxonomy, CLI/plugin on/off; xem [RDC_G1_TOOL_REFUSALS_EVIDENCE_2026-10-20.md](./RDC_G1_TOOL_REFUSALS_EVIDENCE_2026-10-20.md). **Đừng suy ra đã loại bỏ mọi random refusal**; platform pre-dispatch denial do ChatGPT/app không khắc phục bằng hạ local policy.
- **G2:** Nhiều regression/process/PTY/slow I/O/stream/stop/restart/lost ACK; Windows Job Object `kill-on-close` và real physical owner Windows #441 E2E, Linux POSIX process group cleanup, macOS/Linux packaged CI. Handoff liên quan: [Windows owner G2](./RDC_GOLD_G2_WINDOWS_441_OWNER_E2E_20261020.md), [Linux group cleanup](./RDC_GOLD_G2_POSIX_NATURAL_PARENT_REAP_20261020.md), [TCP + PTY unknown](./RDC_GOLD_G2_TCP_ABORT_PTY_UNVERIFIED_20261020.md). Không nói tất cả G2 physical interruption/real Mac đã xong nếu chưa có bằng chứng.

### G3 — chuỗi logic quan trọng đã phát triển

1. **Fleet Router stale channel/inflight:** transport stale không cho dispatch mới, nhưng giữ work chưa rõ kết quả; queue/lease/late receipt trung thực, tránh replay tác dụng phụ.
2. **Half-open Duplex watchdog:** client stream vẫn TCP-connected nhưng server ngừng gửi frame → bounded receive idle timeout (~35s default) rồi reconnect; diagnostic counter.
3. **Hung/rejected executor:** channel heartbeat fresh không đủ chứng minh executor hoạt động; reject / in-flight hang phải chuyển readiness thành degraded và không đánh dấu command thành công giả.
4. **Independent ExecutorReadinessProbe:** probe chạy native Node child process định kỳ độc lập với heartbeat; timeout, freshness, recovery, stale evidence; signed Agent hello/heartbeat/poll báo `executorReady`. Script `lib/executor-readiness-probe.mjs`.
5. **Reconnect race:** callback poll sau wake phải dùng trạng thái readiness hiện tại, không chụp snapshot cũ dẫn tới `ready → degraded` giả. Fault reconnection, no duplicate result và late receipts có regression.
6. **Cryptographic UAT fixture:** Ed25519 EnrollmentRegistry begin/approve/poll/signed hello, chống tamper/replay nonce, disconnect/reconnect mới, 6 markers PASS trên VPS-ARM và staged Gold LXD; ***fixture in-memory identity KHÔNG phải owner-approved live Gold Agent***.
7. **Local Wall observability:** authenticated `/api/status` cho Executor status/probe/checks/failures, UI phân biệt probe healthy nhưng command hung; test HTTP thực trong ARM LXD.
8. **Real Agent OS-process tests:** tiến trình `operator-agent.mjs daemon` thật chạy riêng, authenticated Local Wall, SIGSTOP/SIGCONT, periodic probe, clean SIGTERM, 2 rounds ARM LXD và CI macOS/Linux. Khoảng 10s lifecycle **không** chứng minh memory ceiling dài ngày.
9. **Bounded TCP soak:** 3×3 real localhost scenarios, p50/p95/RSS sample; staged real Linux LXD. Đây vẫn là bounded fixture, không phải long-duration enrolled live-agent soak.
10. **Synthetic enrollment CLI fixture:** khắc phục test kế thừa `OPERATOR_AGENT_IDENTITY_FILE` và NetBird Wall bind từ VPS-ARM bằng *clearing environment in synthetic test subprocess*, 11/11 PASS VPS-ARM/LXD. Runtime Agent thật không đổi khóa hay host; fixture không phải live Gold account approval.
11. **Optional strict Executor admission:** `OPERATOR_REQUIRE_EXECUTOR_READY=1` **chỉ opt-in**, không bật ở Gold hiện tại; unknown=false for dispatch, explicit false deny, true ready. Nếu mặc định compatibility thì legacy chưa gửi probe vẫn được dispatch; **source HEAD eca1f98** mới tách `dispatchReady=true` khỏi `executorReadinessProven=false` và gắn `readinessReason=executor_unknown_compat`, thay vì label ready. **Thay đổi này CHƯA được deploy vào Gold Operator live**; phiên sau muốn thấy UI reason mới phải làm Gold-only versioned cutover theo quy trình.
12. **Deployed Gold Operator source parity:** Trước 2026-10-20 live UAT Operator source cũ; đã dựng release archive candidate, backup, thử cutover, fix lỗi package/permissions/systemd và **cutover thành công** trên candidate `a74ec1b`. Audit live hash actual process TRUE. Source HEAD sau đó tiến lên `39a04e2` nhưng deployment vẫn pinned `a74ec1b`.

### Các CI/mốc GitHub đã xác minh

| Run | SHA/Scope | Kết quả đã xác minh |
|---|---|---|
| [Gold Operator #12](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39446677559) | UAT cutover shell source contract, runtime tests | **6/6 SUCCESS**, gồm 2 Linux server bundle architecture |
| [Gold Operator #13](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39450315399) | source `eca1f98` | **6/6 SUCCESS** (Operator contract, ARM64/x64 server bundle, lifecycle, enrollment synthetic, bounded soak) |
| [Windows #452](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39439603736) | source `a74ec1b` | SUCCESS, installer/updater rollback; **CI build ≠ cài trên owner PC** |
| [Windows #453](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39450315433) | source `eca1f98` | **SUCCESS** full; job log có output runtime `windows-installed-g3-executor-probe=PASS` và `windows-native-installed-selftest=PASS` SAU bước installer thật trên GitHub Windows runner |
| [macOS #249](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39439603628) | source `a74ec1b` | SUCCESS (CI Intel/Apple Silicon) |
| [Linux Desktop #290](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39433635949) | G3 real Agent lifecycle | x64/ARM64 SUCCESS |
| [macOS #248](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39433635946) | G3 POSIX real-Agent suspend/resume lifecycle | Intel/Apple Silicon SUCCESS; RSS sampling `/proc` Linux-only |
| [Gold #10](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39437851397) | readiness source contract | 6/6 SUCCESS, **không** thay live Operator |
| [Gold #11](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39439603840) | strict readiness source | SUCCESS |

Windows #453 artifact được xác minh trong run artifacts:
- **Tên:** `light-remote-windows-x64-eca1f98e8be492c34da407dc938fd084f6fb2873`
- **Artifact ID:** `12277742496`
- **Archive ZIP SHA256:** `655bc0e891e5a9b7b435f64bb9f04dc85c47b41719fc81890bf8a9c18a03add0`
- **Bytes ZIP:** `328181397`.
- Mở [GitHub Actions Windows #453](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39450315433), mục Artifacts. Nếu tải ZIP, kiểm chính xác SHA archive; **SHA ZIP ≠ SHA installer .exe**. Kiểm hết hạn trong GitHub. KHÔNG dùng ZIP này để copy module lẻ, không suy ra signed/published production release.

## 4. Trạng thái live cuối cùng đã xác nhận

**Lần đo gần nhất 2026-10-20, lập handoff 2026-10-21:**
- Gold UAT `5/5 active`, `/v1/fleet` HTTP 200.
- Fleet 2 outbound leaves **channelFresh=true**.
- `light-remote-gold-uat` local Linux Wall: `executorReady=true`.
- `DESKTOP-VA16D27` Windows: `executorReady=null`; bản cài runtime legacy rc.49; không có module G3.
- Cả hai thuộc cùng Gold synthetic UAT account, đang không có queued/in-flight work ở lần kiểm tra. Phải đo LẠI trước cutover/restart.
- `requireExecutorReady=false` / strict OFF. **Không tự bật khi còn Windows legacy**.
- Đã xác nhận installed Gold runtime candidate path `a74ec1b`; không hot-deploy branch HEAD.
- Windows physical owner device chưa được cài bản CI #453, chưa làm *full* signed dispatch + reconnect trên phiên Gold live.
- Có lần tool pre-dispatch từ chối runner live có test credentials; đã dừng. **Không dùng PTY/alternate transport để vượt safety refusal**. Synthetic protected fixture PASS không thay cho owner-authenticated live E2E.

## 5. Lộ trình vận hành — cần làm NGAY ở phiên kế tiếp

### 5.1 Bước 0 — reconnect đúng target, không đoán session ID

**Official Light Remote** vào VPS-ARM:
- Gọi `light_remote_connection_helper({})` của plugin official đang connected; nếu helper trả session `hold` thì gọi `light_remote_session_control({sessionId: ...})`. Lấy `sessionId` *mới từ helper*; đừng hardcode.
- Context chính: VPS-ARM / device `direct-arm-local` / worktree như bảng phía trên. Không dùng Gold plugin để điều khiển VPS-ARM nếu nó chưa A/B.
- Plugin **Light_Remote_Gold** dùng riêng Windows `DESKTOP-VA16D27`. Gọi Gold `light_remote_connection_helper({})`, kiểm `context.deviceId` và `topology.name=DESKTOP-VA16D27`. Nếu đã approved, helper có thể reuse session; nếu bị hold thì resume; nếu cần A/B mới, theo hướng dẫn hợp lệ của Local Wall, không tự giả lập owner.
- Output exec thường chỉ là job ID; đọc tiếp bằng `light_remote_output({jobId,stream:"stdout",offset:0,limit:...})`. Kiểm `job.state` và `exitCode`; không lấy một `ok:true` của tool làm PASS cho script exit nonzero.

Sau helper, preflight trên VPS-ARM (đổi `SESSION_ID` / `WORKTREE` theo helper):
```bash
cd /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/light-remote-gold-rebuild-20261018
git branch --show-current
git rev-parse HEAD
git status --short
lxc exec light-remote-gold-uat -- systemctl is-active postgresql@17-main redis-server light-remote-gold-operator light-remote-gold-plugin light-remote-gold-wall
lxc exec light-remote-gold-uat -- curl -fsS --unix-socket /run/light-remote-gold-uat/operator.sock http://localhost/v1/fleet
```
Không paste Fleet IDs/account secrets ra public recap. Parse chỉ trạng thái source/parity.

### 5.2 Bước 1 — dùng Windows CI #453 làm nguồn upgrade hợp lệ

1. Xác nhận [Windows #453](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39450315433) `completed/success`, marker `windows-installed-g3-executor-probe=PASS` trong **log**, và artifact ID/hash nêu trên.
2. Kiểm Gold remote session vào `DESKTOP-VA16D27` đang idle; thông báo/nghĩ trước khả năng Agent tự restart và **mất chính kênh Gold plugin trong lúc cập nhật**. Duy trì kết nối VPS-ARM chính qua official plugin để quan sát Gold UAT independent.
3. Chỉ sử dụng **installer/updater nguyên gói, đã qua CI, xác minh checksum**, không `Copy-Item` module vào installed Agent đang chạy, không xóa enrollment/Local Wall account, không tắt policy để “test nhanh”.
4. Sau cài: xác nhận signed install/updater success, `agent\lib\executor-readiness-probe.mjs` tồn tại, `agent\device-agent\operator-agent.mjs` import probe, daemon/background task chạy, `Local Wall /api/status` có `executorProbe` và `executorReady`. Đừng dựa vào `VERSION=rc.49`.
5. Gold Fleet Operator IPC xác nhận `DESKTOP-VA16D27` reconnect với `executorReady=true`; Gold local Wall vẫn true; 2/2 authenticated fresh **không có queued/in-flight**. Nếu mất kết nối, dùng helper/Local Wall A/B theo flow chuẩn; không tự cho reconnect giả qua database.
6. Nếu cài fail: rollback qua official independent updater/helper hoặc installer rollback flow, không hot-patch. Dùng Gold UAT Operator/Wall còn chạy để quan sát; báo chính xác unknown/last error.

**Lưu ý:** Thời điểm handoff này **chưa thực hiện bước cài physical Windows #453**, nên không claim 2/2 or E2E.

### 5.3 Bước 2 — full G3 live Operator acceptance (SAU Windows update)

- Kiểm bình thường login/enrollment/device certificate và approval của Gold account đã authorized; điều khiển chỉ device đã được owner cấp quyền. **Không** giả lập account approval từ in-memory fixture thành pass live.
- Run bounded signed duplex command qua Operator cho một thao tác test-safe không gây side effects bên ngoài không thể rollback; ghi `commandId`/receipt (không log secret). Fault cases: temporary TCP disconnect, receive idle, Agent process restart, stuck executor canary, hung/rejected command, late result; check no false success và không replay effect vô hạn.
- Đo p50/p95 (mẫu có N), reconnect count, RSS sampled, queued/inFlight and orphan count trong **live enrolled runtime**, không dùng chỉ 10s dormant lifecycle fixture làm long soak.
- `Gold Operator` và `Windows Agent` phải cùng một Source/G3 protocol; fact `channelFresh=true` không đủ. Kiểm giấy phép, capability, explicit user deny và lease không đổi.
- Nếu vẫn còn Agent unknown: không bật strict; đề xuất owner-approved drain/upgrade rồi mới thử gate.

### 5.4 Bước 3 — bật strict admission sau khi 2/2 ready

- Feature flag: `OPERATOR_REQUIRE_EXECUTOR_READY=1` (Gold Operator service **chỉ Gold UAT**, cài bằng config/override có backup/rollback), mặc định OFF hiện tại.
- Preflight zero active/queued/inflight/session; restart Operator theo systemd `PartOf` dependency ordering; có backup và rollback verified. **Không** đưa flag vào production.
- Verify `/v1/fleet` trả `requireExecutorReady=true`; fresh Agent has `executorReady=true` and `dispatchReady=true`. Inject Agent unknown/false test isolated → Operator denies new dispatch HTTP 409 `target_node_executor_unknown` / `target_node_executor_unavailable`. Verify already-inflight receipts not fabricated on state flip.
- Nếu một Agent legacy unknown vẫn cần vận hành: giữ compatibility OFF-flag hoặc owner-drain có chứng cứ (không âm thầm dừng tác vụ hay gỡ thiết bị).
- Sau signed live E2E, sustained soak và strict gate thật sự PASS mới được mark G3 DONE / mở G4.

## 6. Gold UAT deployment, backup, rollback — tuyệt đối không dùng trên production

Scripts đã commit vào Gold branch:
- `deploy/scripts/gold-g3-stage-candidate.sh`: nhận source immutable SHA archive, stage độc lập, kiểm dependency lock, node syntax/source test; không restart.
- `deploy/scripts/gold-g3-uat-backup.sh`: backup code, systemd, local state và PostgreSQL custom dump, kiểm SHA256.
- `deploy/scripts/gold-g3-uat-cutover.sh`: explicit opt-in `G3_GOLD_CUTOVER=1`, kiểm queued/inflight/active session=0, package deps/secret root, systemd ordered startup và **10 health samples**; auto rollback khi fail. Gold Wall ExecStart phải có `daemon`.
- `deploy/scripts/gold-g3-uat-rollback.sh`: explicit opt-in `G3_GOLD_ROLLBACK=1`, restore original systemd unit entrypoints, kiểm IPC. Không tự restore database (không schema migration); DB dump giữ cho recovery có kiểm soát.
- `deploy/scripts/uat-gold-g3-readiness-audit.mjs`: read-only, xác định **đúng running Operator MainPID** rồi hash FleetRouter runtime và thống kê Executor proof không lộ identifiers.
- `deploy/scripts/uat-gold-g3-live-enrolled-agent.mjs`: E2E runner có explicit opt-in + account synthetic; **chưa PASS live**, một lần platform pre-dispatch denied. Đừng dùng đường vòng credential.
- `deploy/scripts/selftest-g3-strict-executor-admission.mjs` và các G3 fixtures: source test, không thay cho running service proof.

Backup Gold LXD (sensitive, không sao chép khỏi sandbox):
`/var/backups/light-remote-gold-uat/pre-g3-a74ec1b2203da16ed2469f137684246e35a76ff5`.
Active candidate:
`/opt/light-remote-gold-uat-candidates/a74ec1b2203da16ed2469f137684246e35a76ff5`.
Các lần cutover lỗi thực tế đã rollback: parent mode 0700 gây `status=200/CHDIR`; missing `plugin-server/node_modules/express`; sai `LIGHT_REMOTE_GOLD_ROOT` gây `gold_pg_outside_gold_root`; bỏ `daemon` Gold Wall khiến chạy CLI status rồi exit code 0. Source script hiện đã xử lý; không lặp lại bug hoặc thay root secret guard.

Nếu cần triển khai **HEAD mới eca1f98** chỉ để có reason `executor_unknown_compat` trên live: đó là **cutover mới riêng**, phải stage immutable source HEAD, backup/check sum, zero work, regression, maintenance, rollback như trên. Không tự ý đổi path old release hay symlink trỏ current.

## 7. Source/files/tracing để bắt đầu debug nhanh

| Thành phần | File/chức năng chính |
|---|---|
| G Plan | `docs/optimization/RDC_LIGHT_REMOTE_GOLD_MASTER_PLAN.md` |
| Source Router | `operator-host/fleet-router.mjs` (`requireExecutorReady`, `executorReadinessProven`, `readinessReason`, stale channel, queue) |
| Operator config | `operator-host/executor.mjs` (env `OPERATOR_REQUIRE_EXECUTOR_READY`), `operator-host/executor-routes-runtime.mjs` (IPC `/v1/fleet`) |
| Duplex path | `operator-host/device-duplex-session.mjs`, `operator-host/executor-routes-device-channel.mjs`, `lib/device-duplex-client.mjs` |
| Agent daemon | `device-agent/operator-agent.mjs`, `lib/executor-readiness-probe.mjs` |
| Wall | `device-agent/local-wall.mjs`, `device-agent/local-wall-auth.mjs` |
| G3 core regressions | `deploy/scripts/selftest-g3-strict-executor-admission.mjs`, `selftest-g3-live-readiness-evidence.mjs`, `selftest-g3-signed-enrollment-executor-duplex.mjs`, `selftest-g3-agent-daemon-lifecycle.mjs` |
| G3 TCP soak | `deploy/scripts/soak-g3-duplex-readiness.mjs` |
| Packaging | `client/core-files.json` (includes Executor probe), `.github/workflows/windows-native-client.yml`, `linux-client-build.yml`, `macos-client-build.yml` |
| Installer/updater rollback | Windows workflow `Installed tray client self-test` / `Independent updater staged helper promotion smoke` / `Broken update rollback smoke` |
| G3 UAT cutover history | [source parity/rollback RCA](./RDC_GOLD_G3_UAT_CUTOVER_SUCCESS_20261020.md) |
| Windows G3 state | [legacy owner Agent/installer handoff](./RDC_GOLD_G3_LEGACY_WINDOWS_AGENT_UPGRADE_20261020.md) |
| Crypto fixture | [signed enrollment UAT](./RDC_GOLD_G3_SIGNED_ENROLLMENT_DUPLEX_UAT_20261020.md) |
| Real daemon | [Gold Linux/macos lifecycle](./RDC_GOLD_G3_REAL_AGENT_DAEMON_LIFECYCLE_LXD_20261020.md) |
| CI behavior | [bounded soak and CI isolation](./RDC_GOLD_G3_BOUNDED_SOAK_ARM_LXD_20261020.md) |

## 8. Known blockers / anti-patterns / evidence semantics

**OPEN**:
- Windows `DESKTOP-VA16D27` (owner-approved Gold Agent) old installed rc.49 lacks Executor probe. Needs G3 installer deploy and proof in live Fleet.
- G3 live full signed dispatch + reconnect + late-result/no duplicate + independent executor under fault: not yet accepted.
- Strict feature flag not enabled. 2/2 explicit Executor proof not achieved.
- Long-running enrolled Agent/RSS/latency production-like soak incomplete. Mac owner-device physical E2E previously deferred.
- G4/G5/G6 not started; G5 specifically must show accurate SCP up/down percentage/progress on Local Wall, not fake progress.

**DO NOT**:
- Claim `CI=SUCCESS` means owner Windows installed, or label `channelFresh` / `dispatchReady` as independently-proven executor health.
- Bypass Local Wall A/B, device policy or a ChatGPT platform pre-dispatch denial with PTY/alternate command wrapper.
- Move production operator, Paddle Live, ERPNext/billing, current main, or unrelated Gold files.
- Call Windows rc.49 “same binary” based on version without checking SHA/features.
- Print synthetic test password, OAuth cookies, Ed25519 identity keys, Fleet device IDs, personal data or DB backup.
- Flip strict admission globally or reboot shared UAT during in-flight.
- Automatically restart Gold service just because a code fixture passed.

**Acceptance label vocabulary**:
- `PASS (source fixture)`: Node selftest or real TCP on loopback.
- `PASS (CI package)`: hosted Windows/macOS/Linux compiler/installer smoke, identified by SHA + run/job logs.
- `PASS (LXD staged)`: executed isolated source inside real container, **not installed service**.
- `PASS (Gold live)`: actual installed Operator/Plugin/Wall IPC and authorized Agent, verified after restart.
- `BLOCKED`: do not reclassify until affected live layer actually passes; write exact error, not euphemism.

## 9. G4–G6 — remember but do not jump

- **G4**: operation ID, owner epoch/lease, idempotent effect reconciliation across timeout, lost ACK and post-restart; unknown outcome remains `UNKNOWN` for external shell effects. Do not promise exactly-once external actions.
- **G5**: narrowed CAS/edit race plus **real SCP upload/download progress (%/bytes)** in authenticated NetBird Local Wall (based on acknowledged chunks, transfers, reconnect/reload; preserve SHA check, ownership and no JSON parallel business registry). Owner explicitly requested this.
- **G6**: controlled performance and multi-agent soak with measured baseline p50/p95, RSS, output gaps; no arbitrary expansion of output memory caps.

## 10. Hand-off next turn — exact execution order

1. Read latest branch HEAD + top `RDC_HANDOFF_CURRENT.md` + this handoff; connect official Light Remote VPS-ARM and Gold Windows helper **only if authorized**. Verify Gold 5/5 live, 2/2 leaves fresh, actual current flag/proof, and Windows installed Agent module.
2. Verify artifact #453/current suitable SHA and signed installer updater/rollback. If safe, carry out approved full-package Windows Agent upgrade with restoration plan; no source hot-copy. Expect the Gold session to disconnect and recover; follow normal Local Wall owner flow.
3. Prove **2/2 explicit `executorReady=true`** on the installed Gold UAT; if legacy persists, identify exact artifact/runtime mismatch and correct it first.
4. Run real signed dispatch/reconnect/fault E2E with bounded side effects, evidence/metrics and no accidental duplicate jobs. Then plan Gold-only strict switch with backup and 10-sample rollback-health gate.
5. Only after G3 acceptance update Master Plan / handoff to G3 DONE and move into G4. Document every commit, CI run, status, regression on Linux Server + Windows + macOS/Linux Desktop as appropriate.

**First safe command of next session:** `git rev-parse HEAD && git status --short` on the Gold worktree, then observe the five Gold LXD units and Fleet source/version/readiness. **Do not begin by upgrading production, or by repeating all historical fixtures.**

---
**Prepared as a self-contained operational checkpoint.** Read commit log since `39a04e2` for updates; this handoff file will be committed afterward. Repo handoff links remain authoritative even if a ChatGPT conversation session changes.
