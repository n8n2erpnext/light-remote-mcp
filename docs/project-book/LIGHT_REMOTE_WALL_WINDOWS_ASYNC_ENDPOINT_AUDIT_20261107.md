# Wall + Windows — handoff lỗi UI, bất đồng bộ, duyệt B và endpoint

Status: verification / proposal; AUDIT ONLY, chưa áp dụng bản sửa.
Date: 2026-11-07, Asia/Saigon (UTC+07).
Scope: Wall R5, Long Memory/Codex UI, signed A/B V2 approval, Windows .NET/Tauri/Agent/updater/watchdog và cấu hình URL.
Supersedes: không thay lịch sử; nối tiếp [audit T09](LIGHT_REMOTE_ABV2_DESKTOP_V4_AUDIT_HANDOFF_20261107.md) trong cùng Living Master.
Primary sources: Git, các file source Windows đã cài, file overlay Lab được đọc riêng, ba ảnh Owner cung cấp và bốn nhóm probe offline dùng dữ liệu giả.

## 1. Kết luận để người tiếp nhận bắt đầu

Có **11 hạng mục**: 2 P1 (một blocker đã tái hiện, một rủi ro updater có điều kiện), 8 P2 kỹ thuật và 1 yêu cầu UX P2 của Owner. Lỗi hình 1 có nguyên nhân CSS rõ ràng; lỗi Wall không duyệt B có nguyên nhân CSRF rõ ràng; ba lỗi bất đồng bộ khác đã tái hiện bằng chính hàm source trong VM. Ảnh 2/3 còn thể hiện luồng điều khiển Long Memory không đối xứng: Enable ở màn OFF nhưng khi ON vẫn dùng checkbox + Save.

**Next duy nhất: T10-F01 — review patch renderer CSRF của Wall B và gate browser-click tương ứng.** Sau đó sửa contract CSS 3 vùng; tiếp đến state/revision, form approval, cấu hình/update isolation. Task này chỉ tìm lỗi và ghi handoff, không phải yêu cầu tự động thực hiện các patch.

Đề xuất **JSON làm một nguồn cấu hình có schema/profile/revision**. Có [mẫu JSON để review](LIGHT_REMOTE_ENDPOINTS_PROPOSED_20261107.json) và [inventory URL](LIGHT_REMOTE_URL_INVENTORY_20261107.json). Chúng là tài liệu thiết kế, không phải config chạy thật; chưa được cài vào app.

## 2. Mốc source, Windows thật và Lab

| Lớp | Bằng chứng đã đọc | Giới hạn |
|---|---|---|
| Desktop branch | `feat/desktop-v4-api-integration-20261103`, HEAD `614054f29696688bbe22cd269d8cfb302145937f`; executable tree vẫn `0f3c2ee1c826aa6a9e85a99b96811cd8cb2b2a92` | Các commit sau 0f3c2ee1 chỉ là docs/checkpoint; worktree sạch lúc bắt đầu |
| Gold branch | `feat/goldabv2-desktop-owner-lab-20261103`, HEAD `b9194bf4402351a6f565b526eee81541d543c96b`; executable baseline `f2aacc49` | Backend/historical sibling; không lấy thay installer Desktop |
| Windows cài đặt | `C:\Users\Admin\AppData\Local\Programs\Light Remote MCP`; thấy process GUI và .NET host; đọc file tại thư mục này | Chỉ đọc metadata/source, không click, không gọi app/API, không dừng hay chạy thêm process ứng dụng |
| Parity Windows | `local-wall.mjs`, `wall-ui-refinement.mjs`, `operator-agent.mjs`, `wall-ab-v2-preview.mjs`, `gold-ab-v2-lab-v1-lock.mjs`, `public-endpoint.mjs`: **6/6 nội dung khớp Git sau CRLF→LF** | Raw hash khác do Windows xuống dòng; chỉ chứng minh sáu file hiện có, không chứng nhận toàn bộ package hoặc mọi module đã load vào process |
| Binary fingerprint | Tauri SHA256 `9cc1f32de6f70d0a4b6cbcc07a8ab11d69afb364da94ee6995e3d410a022060b`; .NET client `2b40be9726b39e78b537c221dbabda049ff5f717339b54f0dd8518c9afe67574`; VERSION `0.9.0-rc.49` | Fingerprint quan sát, không tự gán nguồn build/CI nếu chưa có mapping artifact riêng |
| Lab read-only ~00:46 ICT | Plugin/Operator/Wall `active/running`, WorkingDirectory `t08-617-{plugin,operator,wall-r5}-0f3c2ee1-STAGED` | Đọc metadata, selected flags, một số file; không restart hay gửi B/grant |
| Overlay parity | Operator `gold-ab-v2-owner-http.mjs`, `gold-ab-v2-signed-approval.mjs` khớp Git sau normalize; Wall CSS refinement và V2 preview khớp; Lab `local-wall.mjs`/`operator-agent.mjs` khác Git thật | Overlay có lịch sử riêng; folder chứa SHA không chứng minh cả cây là SHA đó. Probe B01 đã kiểm tra cả renderer overlay |

Living Master/AGENTS, full handoff, native A/B, Wall refinements, module store, T09 và Code Map/Worklog/checkpoint đã được đối chiếu. Giữ tách biệt source, file installed, process metadata, CI và nghiệm thu GUI.

Không thay source, app đang cài, service, flags, DB/Redis, enrollment, module settings, B/consent hay updater. Không dùng B/token thật. Các đoạn mã kiểm chứng chạy cục bộ với DOM/fetch giả; không có grant hoặc kết nối app được tạo.

## 3. Phát hiện và hướng xử lý chưa thực hiện

### T10-01 — P1: renderer V2 cắt mất CSRF, Wall không duyệt B được

`device-agent/local-wall.mjs:2337–2339` tạo `const wallCsrf` trong script của trang V1. Renderer V2-only tại `:2729–2736` dùng `base.slice(0,legacyStart)+fragment+...`, nên cùng lúc xóa cả V1 DOM **và script cấp biến CSRF dùng chung**. Decorator tại `wall-ui-refinement.mjs:158–180` chỉ đưa token vào hidden logout form, không cấp biến cho V2 script.

Nút V2 tại `wall-ab-v2-preview.mjs:204–209` gửi header `x-light-remote-csrf` từ `typeof wallCsrf==='string'?wallCsrf:''`. Kết quả là chuỗi rỗng. `local-wall.mjs:2432,2657–2661` từ chối `403 csrf_invalid` **trước** khi kiểm B hay chuyển tiếp signed approval. Nhập đúng B và consent vẫn không vượt được gate cục bộ này.

**Probe offline:** dựng trang từ `approvePage` thực + phép cắt V2 + decorator thực; click handler V2 chạy trong DOM/fetch giả. Header bắt được `""`, trong khi hidden logout token vẫn tồn tại. Control có fixture CSRF riêng gửi `fixture-csrf`; mocked server luôn từ chối nên control chỉ chứng minh header transport, không phải grant PASS. Kiểm tra renderer Windows đã cài và overlay Lab cũng đều mất JS initializer. Lab overlay có vị trí tương ứng `local-wall.mjs:2320,2603–2609`, gate `:2533–2534`.

**Vì /account vẫn có thể hoạt động:** đây là entry point độc lập. `plugin-server/account-portal/ab-v2.js:34–40` lấy CSRF riêng, gửi `x-light-abv2-csrf` tại `:18–22,65–66`; `account-ab-v2.mjs:45–59` chuyển principal/CSRF đã kiểm chứng vào Owner route. Không dùng việc /account thành công để kết luận Local Wall đã hoạt động.

**Đề xuất:** renderer V2 nhận CSRF request-bound qua tham số rõ ràng, serialize an toàn; không phụ thuộc biến do script V1 sở hữu. Giữ V1 DOM vắng mặt, giữ toàn bộ CSRF/Origin/Owner/device/B/durable-grant checks. **Không bỏ kiểm CSRF để chữa triệu chứng.** Test click từ HTML được render thật, token đúng/sai, stale attempt, hai lần click và durable outcome trong fixture biệt lập. Selftest hiện có compile script và POST fixture header trực tiếp nên bỏ sót bug browser.

### T10-02 — P2: CSS 4 cột cũ ghi đè markup 3 vùng, khớp hình 1

`local-wall.mjs:496` render 3 child trực tiếp: `.joblead` chứa status+time, `.cmdwrap` chứa command, `.actions`. CSS base tại `:65` đã đổi thành 3 cột `max-content minmax(220px,1fr) auto`.

Nhưng `WALL_UI_REFINEMENT_CSS` chèn sau tại `:98`, selector cụ thể hơn `.term .commandrow` trong `wall-ui-refinement.mjs:79` vẫn dùng **`58px 86px minmax(220px,1fr) auto`**. Trên 870 CSSpx: status+time bị ép vào 58px; command tự đặt vào cột **86px**; actions chiếm vùng lớn thứ ba; cột thứ tư trống. Cửa sổ rộng thêm cũng không giải phóng command, đúng hình 1. Không phải do PowerShell dài cần bị cắt chữ.

**Đề xuất:** một contract layout có 3 grid regions/areas tương ứng markup; loại selector ghi đè đã lỗi thời, giữ `min-width:0`, command đọc được và actions wrap riêng. Test 800/870/871/1280/2560 CSSpx, sidebar mở/đóng, DPI125%, câu lệnh nhiều dòng, badge/risk/progress. Kiểm bounding box/computed columns, không chỉ ảnh screenshot. Chưa chạy browser geometry mới trong audit; kết luận từ cascade/markup xác định và ảnh Owner, cộng parity file installed.

### T10-03 — P2: module state stale giữa tab, response cũ làm revision đi lùi

`goldModulesRefresh()` tại `local-wall.mjs:570–588` ghi trực tiếp checkbox, notice/area và dataset revision, không có sequence hay nondecreasing revision gate. Nó chỉ chạy khi load hoặc cùng tab mutation; `visibilitychange :568` và SSE `:566` không refresh module flags. Configure API `:2753` không phát module-change event.

**Hai trường hợp:** tab A Enable, tab B vẫn OFF kể cả quay lại focus; B gửi revision cũ bị409, catch `:671–673`/`:2020` không refetch. Hoặc hai GET hoàn tất ngược thứ tự: probe thực đã ghi ON/rev14 rồi bị response OFF/rev13 ghi đè. Checkbox draft và persisted state còn bị trộn.

**Đề xuất:** store state theo device/account/config revision, bỏ response cũ; một mutation in-flight; đọc lại khi focus, conflict, reconnect. BroadcastChannel chỉ dùng làm tín hiệu invalidation, sau đó authenticated GET; không tin payload tab khác làm authority. CAS `expectedRevision` giữ nguyên. Tách refresh flags nhẹ khỏi notes/checkpoints (`:592`), tránh ghi thành “Enable thất bại” khi module đã lưu nhưng tải dữ liệu con lỗi. Test tab A/B, 13→14→13,409, double-click và child-read failure.

### T10-04 — P2: đọc work A rồi chuyển B có thể hiện nội dung A trong màn B

`goldReaderRequest()` `local-wall.mjs:1011–1017` chụp scopeId trước await nhưng chỉ trả body; `goldReaderRead :1030–1035` ghi shared preview vô điều kiện. `goldMemoryNativeOpenWork(B) :919–937` đổi selector/title nhưng không hủy/invalidate request A. Probe cho kết quả `selected:scope-B` trong khi preview mở với `SCOPE_A_CONTENT`.

Preference refresh `:1104–1115` có cùng race: setting A đến muộn có thể ghi vào UI B. Đây là hiển thị sai scope trong cùng Owner, **chưa có bằng chứng rò dữ liệu cross-account**.

**Đề xuất:** request mang scopeId+generation; chỉ apply khi identity hiện hành còn khớp. Abort khi đổi work/đóng panel/disable module; clear nội dung cũ ngay; preference keyed theo scope. Test slowA/fastB, disable khi request pending, session/device đổi và old-error sau new-success.

### T10-05 — P2: history/SSE đến muộn làm job đã hoàn tất quay về queued/running

Startup chạy `openEvents()` và `loadActivity()` đồng thời (`local-wall.mjs:2151`); focus có thể reload history trong khi live SSE tiếp tục. `ingest :517–523` cho `job_started` ghi đè, dispatched luôn set running, queued chỉ kiểm `!j.finishedAt`; nhưng nhánh `job_finished` lại **không set finishedAt/terminal marker**.

Probe reducer thực: terminal `ok` tại01:00:01, sau đó history queued cũ tại01:00:00 → `queued`, `finishedAt:null`. UI có thể hiện lại Kill/Cancel và báo việc đã xong còn chạy. Backend vẫn là authority, không chứng minh job thực chạy lại.

**Đề xuất:** reducer lifecycle monotonic theo jobId+event sequence/timestamp đáng tin; terminal không bị start/queue/dispatch lịch sử hạ cấp; output đến muộn được merge riêng. Test replay/reconnect/out-of-order/duplicate; terminal vẫn terminal, không mất output hay tạo jobId giả.

### T10-06 — P2 có điều kiện: consent policy do env cục bộ suy ra, có thể lệch Operator đã ký

`gold-ab-v2-signed-preview.mjs:75–78` không trả effective consent mode. Agent `operator-agent.mjs:1345–1352` không project policy này; Local Wall `:2646–2649,2673` và Agent `:1364` tự dùng `goldAbV2LabWallBOnly()` từ local env. Helper cần product ABV2 **và** `LR_GOLD_ABV2_LAB_SIGNED_WALL_B_ONLY=1` (`lib/gold-ab-v2-lab-v1-lock.mjs:5–7`).

Lab Operator được quan sát B_ONLY/WALL_SIGNED_APPROVE/WALL_OWNER_CONSENT/OWNER_APPROVE_HTTP ON; Lab Wall B_ONLY ON. Windows launch source `AgentHost.cs:144–150` không đặt B_ONLY. Audit **không đọc inherited environment của Windows process**, nên không tuyên bố cờ thực tế đang vắng. Với launch mặc định không có inherited flag, Windows tự yêu cầu thêm consent 32 ký tự dù Operator Lab cho B-only.

**Đề xuất:** signed preview công bố enum policy hiệu lực có product/profile binding; Agent/Wall kiểm tương thích và dùng cùng policy. Unknown/mismatch phải giải thích rõ và fail closed. Giữ independent consent ngoài Lab; file endpoint JSON không được âm thầm bật B-only hay quyền Agent.

### T10-07 — P2: form approval bị refresh khi đang xác nhận; lỗi cụ thể bị che

`wall-ab-v2-preview.mjs:97–109,235–237` chỉ giữ form khi input focus; refresh 12s re-render toàn bộ cards. Khi focus chuyển sang dialog/Confirm/Approve, response có thể thay card và request đang nhìn thấy trong khi closure cũ còn POST attempt cũ; không có keyed `approvalInFlight`. Khi đang nhập, signed attempt/revoke mới lại bị bỏ qua tới blur.

`wall-ab-v2-preview.mjs:211–217` xóa B/consent trên mọi thất bại, bỏ error/status thực và hiện chung `Grant not committed by Operator`; Local Wall `:2685–2686` còn gom upstream error ngoài404 thành503. CSRF, wrong Owner, stale attempt, invalid B, revocation, outage và durable outcome chưa rõ vì mất response đều khó phân biệt.

**Đề xuất:** form state keyed `{requestId,attempt}`, khóa mutation xuyên confirm→POST→reconcile, không thay DOM đang thao tác; signed attempt mới phải báo rõ và bỏ input cũ có chủ ý. Mapping sanitized error/status allowlist, tách definite denial và unknown outcome; không log B/secret, không tự retry Approve mù. Test attempt rotation lúc gõ/confirm/POST,409, expiration và lost-response. Đây là source race analysis, chưa thao tác dialog thật.

### T10-08 — P1 có điều kiện: updater không kiểm product/profile, có thể chọn installer khác dòng

GoldABV2 client khóa cloud riêng (`ConnectionConfig.cs:9–17,35–38`), nhưng updater độc lập dùng `main/channels/beta/client-update.json` chung (`LightRemote.Updater/UpdateClient.cs:12–17`). Selection tại `:23–30` chỉ xét schema/semver/platform `windows-x64`, không có product/profile/channel compatibility. Workflow `windows-native-client.yml:230–239` chỉ truyền V4 compile flag cho client, không cho updater; scheduled task chỉ truyền install-dir. Config/state updater không tách theo profile.

**Điều kiện gây lỗi:** một bản regular-Gold mới hơn được ký hợp lệ bằng key được tin cậy và đưa lên feed chung. Selector vẫn nhận bản đó cho GoldABV2; same Inno AppId/install-dir (`GptOperator.iss:32,36,74–87`) cho phép thay entrypoint bằng installer khác dòng khi apply. Check lịch chỉ prefetch; apply-now dùng cùng selection (`LightRemote.Updater/Program.cs:30–52`). **Không khẳng định máy đã tải/cài nhầm**; audit không chạy updater hay thử update, không đánh giá feed hiện tại có artifact xấu.

**Đề xuất:** manifest và config cùng productId/profile/channel/config-schema compatibility; chữ ký hợp lệ vẫn phải từ chối wrong-product. Ràng buộc rollback/cache/status namespace, quyết định rõ upgrade thay thế hay QA coexistence. Test validly-signed wrong-product/newer bị reject; đúng product mới accept; profile rotation không mang enrollment/vault cũ sang authority khác.

### T10-09 — P2: Node đổi được port nhưng App/updater vẫn mở và probe 5491/5492

Agent đọc `OPERATOR_AGENT_WALL_HOST/PORT`, Fleet tương tự (`operator-agent.mjs:103–107`). Rust `main.rs:25–26,52–53`, .NET `TrayApplicationContext.cs:28–30,184–207,283–295`, updater restart/recovery presence `UpdateApplier.cs:66–71` và watchdog `Program.cs:272` lại hardcode5491; Fleet fallback5492.

Đổi Agent Wall sang5499 bằng cấu hình được hỗ trợ thì App có thể mở nhầm5491 hoặc báo recovery lỗi dù Agent5499 hoạt động. Đây là mismatch source, không thay port thực trong audit.

**Đề xuất:** mọi consumer dùng cùng local service mapping/revision trong JSON; vẫn giữ native Local Wall cùng máy/loopback và auth boundary. Test default/nondefault/conflict/down xuyên Node, Rust, .NET, updater, watchdog; không biến Local Wall thành URL remote tùy ý.

### T10-10 — P2: có listener 5491 bị coi là Wall/Agent đúng instance

`WallPortListening()` `TrayApplicationContext.cs:184–189` nhận **bất kỳ TCP listener** trên port5491. `StartAgentTaskVerified :285` trả success ngay; status bridge `:933–942` chọn Stop/Start dựa vào nó, open-wall `:1042–1044` có thể mở service khác. Kiểm tra presence khi updater restart/recovery dùng port-only gate tương tự; nghiệm thu update đầy đủ còn có installed-client selftest và core ACK, không chỉ port check.

**Đề xuất:** phân biệt port occupied / service responding / expected product+install instance healthy. Bounded nonsecret identity handshake và PID/install-path ownership; conflict phải báo rõ. Không giết listener ngoài phạm vi quản lý. `KillStaleWallListener` hiện có path check cần giữ. Test fixture listener không liên quan và wrong-profile Wall, không dùng máy Owner để tạo xung đột.

### T10-11 — yêu cầu UX P2: Long Memory ON phải có Disable trực tiếp

OFF view tạo `Enable Long Memory` (`local-wall.mjs:638–674`); ON view đưa checkbox và `Save modules` cũ vào Settings (`:800–809`, markup `:102`), không có `Disable Long Memory`. Codex đã có cặp Enable/Disable (`:606–637`). Vì vậy hình2 OFF rồi hình3 checked+Save **tự nó không chứng minh persistence thất bại**; đó còn là thiết kế hiện tại không khớp yêu cầu Owner. T10-03 là lỗi stale/race riêng đã tái hiện.

**Contract đề xuất theo yêu cầu Owner:** `unknown/loading → off → enabling → on → disabling → off`, lỗi/conflict riêng. ON hiển thị Disable, OFF hiển thị Enable, pending khóa nút, dùng flag persisted có revision; không dùng checkbox draft như trạng thái đã lưu. Mỗi action chỉ thay module đó, giữ module khác. CAS backend `gold-wall-modules.mjs:124–134` phải giữ. Có thể chuyển từ PUT hai boolean sang desired-module patch có kiểm revision; đây là thiết kế cần implement sau. Disable không được đồng nghĩa xóa memory hoặc tự đổi sync/capture authority.

## 4. Một JSON làm nguồn endpoint — phương án cụ thể để review

**Chọn JSON** vì Node/.NET/Rust hiện đã parse JSON; XML thêm một bộ tooling mà chưa có lợi ích cho contract này. Một file authored `config/endpoints.json` chứa schemaVersion, configRevision, selectedProfile, productId, typed cloud origins, local service host/ports, relative route catalog và update channel/feed. Không thêm file constants độc lập phải sửa tay ở mỗi ngôn ngữ.

Inventory tĩnh đã quét **327 file**, thấy **114 vị trí / 77 URL literal hoặc template khác nhau** trong Windows/Tauri/Agent/Wall/Operator/Plugin/lib. [JSON inventory](LIGHT_REMOTE_URL_INVENTORY_20261107.json) giữ file+line. Nó bao gồm comments/standards/embedded fixtures chưa phân loại; không suy ra env, chuỗi ghép, route không có URL đầy đủ hoặc IPC. Vì vậy đây là danh mục rà soát, **không phải tuyên bố 77 endpoint đều phải cấu hình**. Query/fragment contents đã loại khỏi inventory; cần phân loại ngữ nghĩa trước migration.

| Consumer | Hiện tại | Cần quy về nguồn chung |
|---|---|---|
| .NET GoldABV2 | `ConnectionConfig.Load()` trả constant, bỏ qua `connection.json`; Save lại ghi file nhưng Load không dùng | Chọn đúng profile đã validate từ config chung; không bỏ isolation khi sửa loader |
| Legacy .NET | env → saved JSON → defaults, với alias migration | Profile riêng, precedence rõ; nếu chỉ có một env key thì cách merge key còn lại phải có test |
| Node package | generated `goldabv2-package-profile.json` vẫn bị so với URL literal trong `operator-agent.mjs:73–85` | Marker được sinh từ cùng config, không thêm nguồn hardcode thứ hai |
| Rust Owner | `owner_login.rs:27–33` lặp origin và các URL authorize/token/refresh/session/snapshot/logout; ticket có URL riêng | Origin + route name → URL builder; giữ redirect deny và issuer/audience binding |
| Local Wall/browser | Phần lớn relative same-origin API | Giữ relative path và cookie/CSRF; không cấp bearer hoặc arbitrary baseURL cho JS |
| Updater/watchdog/installer | Feed/state/path/port độc lập | Nhận selected profile + absolute config path + product contract, dùng cùng revision và last-good verified copy |

**Cách “đổi một file app đổi theo”:** build/packaging/loaders cùng đọc một config canonical; artifact copy/generated resources chỉ là output có digest, không sửa tay. Runtime báo effective product/profile/configRevision không có secrets. Display link có thể reload có kiểm tra; đổi listener port cần coordinated restart; đổi cloud issuer/Operator cần Owner sign-in/relink và namespace mới, **không gửi refresh/access/enrollment cũ sang origin mới**. Không hứa một text edit tự đổi authority đang chạy giữa phiên.

Cloud origin chỉ được là HTTPS origin chuẩn, không userinfo/path/query/fragment; local host/port có schema loopback riêng. Route path không nhận absolute URL, `//`, traversal hay method tùy ý; fragment tách riêng. Ephemeral callback port là runtime data. Các endpoint server private, public Owner, MCP, local Wall/Fleet và official third-party auth có vai trò khác nhau, không gộp thành một domain mặc định.

Config release cần integrity/signature theo public trust anchor đã được tin cậy độc lập; signature/generated copies là artifacts, không phải nguồn cấu hình thứ hai. Parse/schema/signature/profile failure phải fail closed, không fallback sang Gold production cũ. Không đưa token/key/B/consent/grant/permissions vào JSON. Consent/B-only và module enable không phải “cấu hình URL”, không được tự bật qua centralization.

Mẫu proposal để `manifestUrl/signatureUrl` là **null/HOLD** vì chưa xác định feed GoldABV2 riêng được phê duyệt; không bịa URL update có thể dùng ngay. Legacy aliases phải phân loại theo từng profile trước khi chuyển, không replace-all domain.

**Migration chưa thực hiện:** (1) inventory/typed schema + read-only effective-config parity; (2) Node/.NET/Rust cùng loader/profile, giữ behavior cũ bằng tests; (3) propagate updater/watchdog/installer và manifest product binding; (4) packaged Windows E2E ở default+nondefault port, auth/B/module/status/rollback; (5) gỡ constants trùng, CI chặn deployment URL literal mới ngoài registry. Chỉ sau parity/acceptance mới thay config phát hành.

## 5. Tối ưu và code thừa/bảo trì cần ghi lại

- **Renderer stream:** `renderJob :496` gán lại toàn bộ `innerHTML`, tô syntax command không đổi, gắn lại handlers và render output cho mỗi dirty flush (`:516`). Giữ batching50ms hiện có; đề xuất incremental status/output + command syntax cache, tránh mất selection/scroll. Đo DOM nodes, long task/event-loop, p95 render và RAM ở250/1k/2.5k jobs; không cắt mất nội dung Copy/raw để làm UI nhanh giả.
- **Module loading:** flags refresh không nên đợi notes/checkpoints/scopes của panel không mở. Tách flag snapshot nhẹ và lazy load theo pane, AbortController khi rời pane, lỗi con độc lập. Dùng một state store có revision/identity cho LM/Codex/nav; tránh checkbox ẩn làm nguồn boolean thứ hai.
- **Approval:** feed có in-flight/backoff/visibility, keyed forms không rebuild khi đang nhập/confirm; vẫn nhận revocation/attempt change có kiểm chứng. Không cache quyền/grant để tránh request kiểm tra authority.
- **CSS/code cũ:** stale4-column rule là code còn hiệu lực gây lỗi, không chỉ “code thừa”. Hợp nhất ownership style/renderer, tránh nhiều lớp cùng định nghĩa layout. Giữ V1 shared source cho regular Gold nhưng tách renderer V2 không dùng biến V1. Checkbox/Save LM chỉ retire sau khi symmetric action mới có CAS/Owner regression.
- **Windows:** T09 missing Tauri Link IPC permissions, caller deadline, non-Windows capability và unstable onClose vẫn còn nguyên vì source không đổi. Tham chiếu T09 thay vì coi audit trước đã sửa. JSON tập trung chủ yếu giảm drift/bảo trì, chưa phải bằng chứng tăng tốc; parse một lần mỗi revision và đo process/network count trước khi hứa hiệu năng.

## 6. Bằng chứng kiểm chứng và gate tiếp theo

| Nhóm | Kết quả quan sát | Không được suy diễn |
|---|---|---|
| Rendered V2 CSRF | JS initializer mất ở Git, Windows installed và Lab overlay; handler giả gửi header rỗng | Không có real B/grant hay HTTP live được thử |
| Revision race | ON/rev14 → OFF/rev13 khi response về ngược | Không đọc/sửa module state thật của Owner |
| Scope race | selection B nhưng preview hiển thị dữ liệu giả A | Không chứng minh cross-account exposure |
| Job reducer | `ok → queued`, finishedAt còn null sau history cũ | Không chứng minh job thực chạy lại |
| CSS | 3 DOM children vs selector4columns, command86px; parity installed6/6 | Chưa đo bounding box bằng browser mới; ảnh Owner là symptom evidence |
| Updater | Source thiếu product binding và dùng feed chung | Không tuyên bố update nhầm đang xảy ra |
| Endpoint inventory/proposal | JSON parse được; static327files/114positions/77values | Chưa tạo loader, hot reload hay đổi endpoint nào |

Lượt triển khai sau cần nghiệm thu **cả hai** đường Wall B và /account độc lập, giữ CSRF/Owner/enrollment/B checks. Ngoài happy path: stale/wrong B, wrong device/Owner, session expired, duplicate click, unknown durable outcome, consent mode mismatch. Với UI: multi-tab, slow/reversed responses, reconnect, terminal monotonicity, pane/scope switch. Với Windows: product/profile/port đồng nhất giữa GUI/Agent/Wall/updater/watchdog và signed wrong-product update bị chặn.

Trong lượt audit này chỉ bộ báo cáo, hai JSON thiết kế/inventory, Living Master, Worklog và checkpoint được ghi. Source, runtime và cài đặt Windows không thay đổi. Docs CI/publication receipt được ghi riêng trong Master khi có kết quả, không dùng nó thay nghiệm thu code hay GUI.
