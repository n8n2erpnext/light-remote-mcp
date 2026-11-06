# Handoff rà soát AB v2 và Desktop UI v4

Status: verification / audit-only; chưa áp dụng bản sửa hoặc tối ưu.
Date: 2026-11-07, Asia/Saigon (UTC+07).
Scope: Light Remote trong `/home/ubuntu/n8n2erpnext`; Gold AB v2, Desktop V4, Node Agent/Wall/Operator/Plugin và Windows bridge.
Supersedes: không thay thế lịch sử nghiệm thu; bổ sung phát hiện cho Living Master hiện hữu.
Primary sources: snapshot Git chính xác, source registry/IPC/Tauri, docs và handoff Project Book; metadata systemd đọc qua SSH.

## 1. Kết quả và giới hạn

Đã SSH thành công vào VPS-ARM (aarch64). Ghi nhận 7 mục cần xử lý: một blocker P1 ở quyền IPC, năm mục P2 về dữ liệu/độ ổn định/UI và một mục P2 về continuity. Có thêm ba nhóm tối ưu hiệu năng và ba ghi chú code thừa/bảo trì. Mức độ ở đây phản ánh tác động khi dùng tính năng tương ứng, không phải bằng chứng đã xảy ra sự cố production.

Chỉ đọc source và metadata trên VPS; phép thử mới chạy cục bộ trong `work/`, dùng dữ liệu giả trong bộ nhớ. Không chạy Agent/app, không cài native app, không thực hiện B approval, không đọc credential vault, không restart/deploy, không đổi flags, không migration hoặc xóa dữ liệu. Chỉ bộ tài liệu handoff/Worklog/checkpoint được cập nhật. Các đề xuất dưới đây chưa được thực hiện.

| Nhánh/worktree | SHA source được audit | Vai trò |
|---|---|---|
| `feat/desktop-v4-api-integration-20261103` / `desktop-v4-shared-ui-20261101` | `0f3c2ee1c826aa6a9e85a99b96811cd8cb2b2a92` | Nhánh tích hợp hiện hành; gồm T08 bỏ allowlist tĩnh/V1 DOM, Windows unified app |
| `feat/goldabv2-desktop-owner-lab-20261103` / cùng tên worktree | `f2aacc498fb3ad7e5fa99f3355c5a093f9980cee` | Backend/historical canonical; không dùng thay nhánh installer hiện hành |

Cả hai worktree sạch trước khi ghi tài liệu. Đã đọc sơ đồ nhánh predecessor: Desktop shared/login/wall-activity; Gold single-owner-transfer, device-local-activity; GC/reconciler và LM Chrome. Chỉ hai HEAD trên được rà soát chi tiết, không tuyên bố audit toàn bộ mọi nhánh lịch sử hoặc mọi subsystem.

Nguồn continuity đã đọc: `AGENTS.md`, Living Master (phần 0, 8–11, 13 và receipt cuối), full handoff 20261106, API/Owner auth/native A/B/T04 local Wall handoffs, Code Map, Worklog, Library Rules và checkpoint. Trạng thái source, CI, runtime và physical E2E được giữ riêng.

## 2. Phát hiện ưu tiên

### A01 — P1: luồng Link/Relink mới thiếu quyền IPC Tauri

**Bằng chứng source:** `client/desktop-v4/src-tauri/src/main.rs:119` đăng ký `desktop_native_action` và `desktop_link_ui_intent`; UI gọi hai lệnh tại `src/DeviceLinkDialog.tsx:18,23`. Nhưng `src-tauri/permissions/desktop-owner.toml:5` không cho phép cả hai; cũng không có permission khác cấp hai command này. App đã bật application ACL qua `build.rs:17` và capability trong `tauri.conf.json:35`.

**Tác động suy ra từ ACL:** React không gọi được bridge status/preview/link/poll; polling ý định Link từ tray cũng bị từ chối. UI bắt lỗi thành `agent_unavailable` hoặc `false`, dễ làm người dùng tưởng Agent hỏng dù tray/native build chạy. Đây là blocker ở mức source cho luồng Link UI, chưa tái hiện bằng cài đặt trên Windows thật trong audit này. Native tray callback trực tiếp Rust là đường khác và không chứng minh IPC từ WebView hoạt động.

**Đề xuất:** khai báo permission hẹp cho hai command, gắn đúng cửa sổ/platform, đồng bộ danh mục command trong build manifest. Tránh mở rộng quyền chung. Gate cần có: gọi thực từ WebView đã đóng gói tới status/preview và tray Link intent; command không cấp quyền vẫn phải bị từ chối.

**Vì sao CI chưa phát hiện:** `selftest-goldabv2-unified-one-app.mjs:16–45` kiểm tra chuỗi source và lifecycle, không kiểm tra resolved ACL hay invoke thật. `native-shell.test.ts` chỉ kiểm tra một phần danh mục quyền. Có thể compile/installer PASS trong khi command mới không được gọi.

Tham chiếu cơ chế: [Tauri capabilities](https://v2.tauri.app/security/capabilities/) và [Tauri command filtering](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-macros/src/command/handler.rs). Đây là cơ sở framework cho suy luận, không thay physical proof.

### A02 — P2: snapshot dùng sai schema Device Registry, mất tên và Short ID

**Bằng chứng:** `operator-host/desktop-v4-owner-snapshot.mjs:29–32` đọc `deviceName || name || label`, trong khi `device-registry.mjs:43–68` trả `displayName`. `executor.mjs:1415–1416` chỉ làm giàu routing/policy/connection/compatibility, không thêm `shortId`; snapshot lại chỉ đọc `d.shortId`. Short ID thật nằm trong bảng PG043 và được đọc riêng ở signed channel.

**Tái hiện in-memory với DeviceRegistry thật:** đăng ký tên `Review Windows` → registry trả tên đúng nhưng snapshot trả `name:null, shortId:null`. `FeatureScreens.tsx:160–161` vì vậy hiển thị deviceId và `—`. Fixture tại `desktop-v4-owner-snapshot.test.mjs:9` tự tạo `deviceName/shortId`, che mất lỗi tích hợp.

**Đề xuất:** map từ `displayName`; bổ sung lookup Short ID theo đúng Owner+device, dạng batch, fail closed khi thiếu schema/binding. Test dùng registry thật và lớp lookup thực đã inject, không tự dựng shape giống implementation.

### A03 — P2: vượt 200 job lịch sử làm sập toàn bộ Owner snapshot

**Bằng chứng:** `desktop-v4-owner-snapshot.mjs:60–62` gom mọi job của Owner rồi ném lỗi nếu quá 200, bao gồm job terminal. `executor.mjs:111–112,698–708` giữ job hoàn tất mặc định 6 giờ và giới hạn theo bytes, không giới hạn 200 job. Hai contract không khớp.

**Tái hiện in-memory:** 201 job `status:'ok'`, đã có `finishedAt` → `desktop_snapshot_jobs_too_large`, status 409. Các tab Account/Devices/Sessions cũng mất dữ liệu vì dùng chung snapshot. Tương tự, hơn 200 session còn trong history có thể đánh hỏng toàn bộ response tại dòng 37–38.

**Đề xuất:** phân trang/lấy cửa sổ lịch sử có `hasMore`/cursor/tổng rõ ràng; giữ job đang chạy và tách lỗi từng phân vùng. Không bỏ giới hạn bộ nhớ hoặc âm thầm cắt dữ liệu thành số đếm đầy đủ. Test mốc 199/200/201 job, nhiều session terminal và Owner khác.

### A04 — P2: Windows IPC và bridge process thiếu deadline phía gọi

**Bằng chứng:** `owner_abv2.rs:72–77` dùng Windows pipe blocking rồi `read_to_end`, không timeout/cancel; Unix có read/write timeout ở dòng 85–86. `unified_tray.rs:62–66` chờ `.output()` không deadline. Child .NET tiếp tục chờ Node `WaitForExitAsync()` không cancellation tại `TrayApplicationContext.cs:128–135`.

**Tác động:** nếu peer/child bị kẹt, Approve có thể giữ spinner mãi; pending polling 8 giây có thể tiếp tục tạo tác vụ chưa hoàn tất; tray thread có thể ngừng cập nhật. Agent có timeout socket 16 giây, nhưng client vẫn thiếu bảo vệ độc lập khi peer hoặc event loop bị treo. Chưa gây treo process thật để kiểm chứng.

**Đề xuất:** deadline end-to-end, pipe async có timeout, giới hạn output ngay lúc đọc; child timeout phải thu hồi đúng process tree do bridge sở hữu. Dedupe/in-flight guard cho polling; không retry tự động thao tác Approve không idempotent. Nghiệm thu bằng peer trì hoãn/không EOF trong fixture biệt lập.

### A05 — P2: macOS/Linux hiện Link UI cho command chỉ tồn tại trên Windows

**Bằng chứng:** `DeviceLinkDialog.tsx:12–14` chỉ xét build flag Owner và có `invoke`; không xét platform/capability Link. `main.rs:8,128–141` chỉ biên dịch/đăng ký `desktop_native_action` và `desktop_link_ui_intent` trong nhánh Windows. UI chung tại `App.tsx:624–626,691` vẫn hiển thị Link/Relink trên Owner build của các OS khác.

**Tác động suy ra:** người dùng macOS/Linux mở dialog có tiêu đề Windows, mọi action trả unavailable vì command không tồn tại. Owner login riêng của các OS này không chứng minh Link bridge được hỗ trợ.

**Đề xuất:** trả capability native rõ ràng hoặc gate theo platform, chỉ hiển thị luồng đã có implementation; test packaged command map cho cả ba OS. Nếu cần hỗ trợ ngoài Windows, viết adapter riêng theo cùng contract sau lượt triển khai được giao.

### A06 — P2: callback onClose không ổn định làm lặp khởi tạo Link dialog

**Bằng chứng:** `App.tsx:626,691` truyền `onClose={()=>setShowDeviceLink(false)}` mới sau mỗi render. `DeviceLinkDialog.tsx:48–59` đặt effect theo `[onClose]`, nên mỗi lần parent render lại gọi `status` và `preview`, tạo lại timer/listener. Owner polling cập nhật object mỗi 3 giây; snapshot và pending polling còn tạo render riêng.

**Tác động source:** khi dialog đang mở, các lần init phát sinh nhiều .NET/Node process qua bridge; response preview cũ có thể ghi đè state mới đang link. Không có dữ liệu CPU/latency đo trên máy Owner để lượng hóa mức ảnh hưởng.

**Đề xuất:** callback ổn định hoặc tách lifecycle khởi tạo khỏi callback; fence response bằng sequence và một yêu cầu in-flight. Test rerender parent nhiều lần nhưng status/preview chỉ chạy lúc mở dialog; response cũ không xóa code mới.

### A07 — P2: Living Master/Checkpoint lệch nhánh và metadata runtime

**Quan sát trước khi ghi handoff:** Master Desktop SHA256 `d7e520c08b34d86abe36f943b771258a76d0b11203d659f49ac69a248e738120`; Gold `b3fcf0c3d8fb1c0c666c864993bfc579bb178881e34a43e6fd5d721ef9ec38ee`. Gold thiếu hai receipt T08 cuối. Phần đầu Master vẫn chỉ T07f, checkpoint còn ghi CI/deploy pending.

**Đọc metadata systemd lúc 2026-11-07 khoảng 00:24 ICT:** Plugin, Operator và Wall đều `active/running`, WorkingDirectory lần lượt là `/opt/light-remote-abv2-lab/t08-617-{plugin,operator,wall-r5}-0f3c2ee1-STAGED`. Đây chỉ là metadata được quan sát; chưa so toàn bộ bytes loaded source, flags, DB ledger, signed response hoặc E2E. Không xác nhận ai đã triển khai hay thủ tục triển khai trước đó.

**Đối chiếu CI độc lập:** exact Desktop SHA `0f3c2ee1` đã có Windows full installer run [42252132492](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42252132492) SUCCESS; job `128009694807` SUCCESS. Docs `42252132563`, Truth `42252132665`, GC Source `42252132604` đều SUCCESS. Audit không dispatch/rerun workflow. PASS này không chứng minh A01 hoặc các thao tác GUI trên máy Owner.

**Xử lý tài liệu trong task này:** giữ nguyên receipt lịch sử; đồng bộ Master theo bản Desktop chứa đầy đủ phần nối tiếp, thêm receipt audit và cập nhật checkpoint/Worklog hai nhánh. Không sửa source hoặc runtime. Receipt mới không biến deployment metadata thành nghiệm thu functional.

## 3. Đề xuất tối ưu hiệu năng — chưa thực hiện

| ID | Nút thắt có bằng chứng source | Hướng tối ưu | Cách đo sau khi được giao triển khai |
|---|---|---|---|
| P01 | `UsageRegistry.summary()` gọi `_accrueOpen()` trên mọi connection, rồi `_persist()` đồng bộ toàn bộ state (`usage-registry.mjs:26–30,57–59`). Ba snapshot đọc cách nhau 20s trong probe gây ba lần gọi persist. | Tính projection read-only; gom accrual/persist theo scheduler và dirty state, hoặc transaction storage đã có; giữ chính xác accounting/quota. Không cache proof Owner/grant thay kiểm tra revocation. | event-loop delay p95, số lần/bytes ghi, snapshot latency theo số account/connection; so ledger trước/sau ở boundary tháng và crash. Probe đếm call, không đo IOPS thực. |
| P02 | Snapshot 20s, pending 8s, Owner view 3s và tray status 5s; snapshot/pending không guard overlap (`App.tsx:469–501`). Native kiểm tra HTTPS rồi Agent lại kiểm tra Owner; periodic verification `status_inflight` còn làm `wall_snapshot_current()` từ chối response dù generation/token không đổi (`owner_login.rs:569–576`). | Một scheduler có backpressure/visibility/backoff, lifecycle in-flight và cancellation; IPC event cho link intent thay polling 850ms nếu phù hợp. Phân biệt verification đang chạy với refresh/logout generation fence, vẫn fail closed khi revoke/đổi Owner. | request/process count mỗi phút, số pending promise, p95 khi RTT tăng, Approve trùng thời điểm verification; bảo đảm không cấp lại grant hay báo thành công sai. |
| P03 | `allDeviceViews()` scan fleet trước lọc Owner; mỗi device gọi session-count scan/prune; snapshot lặp `activeGrantsForDevice` scan toàn grants mỗi device (`executor.mjs:1416`, `session-manager.mjs:131–134`, `device-access-grant-registry.mjs:350–359`). | Index account/device và aggregate một lần; batch Short ID cùng A02; giữ limit/pagination rõ ràng, không trả toàn registry/secret ra UI. | fixture đa Owner/1k/10k device: CPU/event-loop/memory/p95, kiểm tra scope âm và giới hạn dữ liệu; không gọi đó là capacity physical. |

Các hardening hiệu năng bổ sung: chuyển HTTPS logout blocking (`owner_login.rs:513–535`) khỏi thread xử lý sync Tauri, giữ signout cục bộ có hiệu lực ngay và báo riêng kết quả revoke; giới hạn byte response trong lúc đọc thay vì sau `response.bytes()` (`owner_login.rs:682–684`); tái sử dụng HTTP client ở mức native để tận dụng connection pool. Chưa có benchmark, không hứa phần trăm tăng tốc.

## 4. Code thừa và bảo trì

1. **D01 — có thể dọn ở lượt nhỏ:** `src/lib/native-snapshot.ts:37` khai báo `SID` nhưng không có tham chiếu. Không ảnh hưởng runtime đáng kể; kiểm tra typecheck trước khi xóa.
2. **D02 — legacy có consumer, không xóa hàng loạt:** `TrayPopoverForm` không thuộc tray runtime GoldABV2 V4, nhưng `Program.cs:22–45` còn dùng cho `--tray-ui-preview`, và regular Gold vẫn có nhánh WinForms. Windows CI vẫn sinh preview cũ. Tách rõ preview/historical artifact khỏi acceptance V4; chỉ loại khỏi V4 package khi đã kiểm kê dependency/resource. V1 shared source cũng còn phục vụ regular Gold; không coi toàn bộ V1 là code thừa của mọi product.
3. **D03 — code chuẩn bị, chưa route:** `operator-host/desktop-v4-owner-close.mjs` chỉ export factory, source runtime chưa import/mount; handoff đã ghi NOT ROUTED. Đây là tính năng chưa tích hợp, không phải API bị hỏng đã live. Chọn giữ có trạng thái/owner rõ ràng hoặc retire bằng quyết định riêng. Comment “ONLY IPC opens Wall” ở `main.rs:1–3` và mô tả permission đã cũ so với login/Approve/service bridge hiện tại; cần chỉnh ở lượt code/docs kế tiếp.

## 5. Ma trận bằng chứng và hành động tiếp theo

| Kiểm tra | Kết quả | Giới hạn |
|---|---|---|
| SSH, hostname/architecture, HEAD/status | PASS | Chỉ đọc; key không in ra/copy vào report |
| Probe DeviceRegistry → Owner snapshot | Tái hiện A02 | In-memory, dữ liệu giả; hai nhánh dùng cùng snapshot module |
| Probe 201 completed jobs | Tái hiện A03: 409 | In-memory, không chạy job thật |
| Probe 3 snapshot/usage persist | 3/3 lần gọi persist | stateFile=null, không ghi usage thật |
| ACL inventory | Hai command mới thiếu permission | Phân tích source + cơ chế Tauri; chưa invoke binary thật |
| Metadata Lab 3 services | active/running; t08 staged directories | Không kiểm tra functional, flags hoặc parity bytes |
| Exact existing CI | Windows/Docs/Truth/GC SUCCESS | Không physical Owner E2E; không dùng CI thay runtime proof |
| Fix/optimization/native install/deploy | NOT PERFORMED | Đúng phạm vi audit/handoff |

**Next action duy nhất:** `T09-F01` — người triển khai đọc A01 và thống nhất patch permission hẹp cùng gate gọi IPC từ packaged WebView. Audit này không cấp phép tự động sửa, build/release, thay enrollment, bật Owner/SSO hoặc triển khai. Sau A01 lần lượt xử lý A02–A03, A04–A06; đo P01–P03 trước khi chọn tối ưu.

Các gate cũ vẫn mở nếu chưa có bằng chứng mới riêng: physical Owner Link/Relink/B GUI provenance, refresh >10 phút trên Windows, revocation backend thực, hai chiều App↔Local Wall SSO, API mutation Close/Revoke. Không dùng CI xanh hoặc metadata service để đóng các gate này.
