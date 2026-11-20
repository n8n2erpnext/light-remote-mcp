# Long Memory, extension ngữ cảnh và API Worker nhiều nhà cung cấp

Status: IMPLEMENTATION_IN_PROGRESS / P1_CI_PASS_P2_P3_CORE_WEB_PASS / P4_CODEX_PILOT_SOURCE / P5_PROVIDER_PILOT_SOURCE / P6_PARALLEL_REVIEW_SOURCE
Edition: 2026-11-15, Asia/Saigon; research audit preserved from 2026-11-11
Scope: Long Memory local-first, Chrome extension ChatGPT/Claude, Codex metadata và API Worker
Research source: `work` `ad3db2f6ffaae0f9de639716e5657dd11bb40da4`; product source digest `537a0a47ba37a0a9a7a3624cb9264961de0ebcc02cd16605543948a7a73d9516`
Authority: cùng [Project Truth](../../PROJECT_TRUTH.md), [Master Checkpoint](../../MASTER_CHECKPOINT.json), [rolling Handoff](../../PROJECT_HANDOFF.md); đây là kế hoạch chuyên đề, không phải checkpoint/handoff mới

## Phạm vi Owner đã chốt

**2026-11-15: Owner yêu cầu bắt đầu triển khai plan Long Memory và API Worker.** Mốc P1 thay remote exec Memory bằng typed request + enrolled signed fetch/push + đọc kết quả theo đúng actor, nội dung chỉ chuyển tiếp trong RAM tối đa120s. Command/job/events chỉ chứa ref/hash/metadata. Client ghi checkpoint và biên nhận chống lặp trong cùng transaction; mất ACK/restart/TTL là unknown và không tự replay. Agent cũ phải cập nhật, không fallback sang shell. Kiểm thử Node cách ly PASS; chưa deploy hay nghiệm thu Chrome/worker thật. Extension, metadata UX, provider adapters và bounded workers vẫn pending.

Research scope dated2026-11-11 (historical, superseded for implementation authorization): Owner xác nhận Long Memory lưu checkpoint/docs ở client và đồng bộ đã hoạt động; Claude dùng endpoint MCP cũng đã test ổn. Chrome extension và trải nghiệm ngữ cảnh xuyên session chưa được test đầy đủ. Owner chọn **nghiên cứu và ghi kế hoạch trước**, không sửa implementation, chạy CLI/provider, gọi tác vụ trả phí, build/test native hoặc deploy trong nhiệm vụ này.

Giữ Long Memory local-first và mục tiêu server chỉ chuyển tiếp nội dung; rà tất cả đường dữ liệu trước khi tuyên bố không có bản sao bền trên server. Chuẩn bị đổi tên hiển thị Codex Bridge thành **API Worker**, cho chọn và setup riêng OpenAI/Codex, Anthropic/Claude và Google/Gemini. Có luồng ChatGPT Web gọi MCP Light Remote, nhờ một worker suy luận/review, nhận kết quả rồi Agent tiếp tục; multi-worker là giai đoạn tiếp theo có kiểm soát.

Không coi báo cáo Owner là nghiệm thu của mọi artifact/profile; không suy từ source có file thành đã tích hợp/enable/physical PASS. Source review và tài liệu chính thức là bằng chứng của kế hoạch này. Các đề xuất route/schema/trạng thái dưới đây chưa tồn tại dưới tên mới.

## Hiện trạng và khoảng trống

| Phần | Đã có trong source / bằng chứng | Còn thiếu hoặc cần xác minh |
| --- | --- | --- |
| Memory local | [scope admin](../../device-agent/gold-memory-scope-admin.mjs#L111): Owner consent, scope opt-in, Home-only, transaction/sign; [Wall](../../device-agent/local-wall.mjs#L3062) gọi module tại thiết bị | Owner đã báo hoạt động; không chạy lại trên dữ liệu thật trong nghiên cứu. |
| Device sync | [gold-memory-sync.mjs:254](../../device-agent/gold-memory-sync.mjs#L254): X25519/HKDF/AES-GCM; [dedicated channel route](../../operator-host/executor-routes-device-channel.mjs#L181) tới relayRAM | Kiểm retention đầy đủ và kịch bản offline/restart bằng dữ liệu giả ở lượt test sau. |
| Extension | Hai variant phục hồi v0.2.0 local và v0.3.0 Lab; capture theo activeTab, staging thủ công | Cả hai ChatGPT-only, endpoint cố định khác nhau; chưa có Claude/restore-to-chat. |
| Codex account/model | App-server đọc account, model/list, rate limits, usage; local provider supervisor/review đã có | Desktop cold page chưa warm metadata; nút Refresh chưa force; nguồn/phạm vi usage chưa rõ với người dùng. |
| Delegation local | [supervisor](../../device-agent/gold-codex-supervisor.mjs): Owner approval, workspace boundary, SQLite CAS lease, receipts, rounds hữu hạn | Chỉ một worker; chưa có tool MCP chính thức cho Agent submit/poll/cancel một reasoning job. |
| Claude/Gemini worker | Có tài liệu CLI/SDK chính thức để xây adapter | Claude gọi Light Remote qua MCP không chứng minh Light Remote đã có Claude CLI/API worker đăng nhập và chạy được. Chưa xác minh adapter tương ứng trong current profile. |

## Long Memory: dữ liệu chính ở client, cần khép đường log MCP

Đường Owner Save ở local Wall dùng Owner auth + CSRF, explicit scope/full-context opt-in rồi ghi SQLite trên Home. Dedicated device sync truyền ciphertext qua [memory rendezvous](../../operator-host/gold-memory-rendezvous.mjs#L104), bounded RAM Map TTL120s; không thấy payload persistence PG/Redis/file trong module này. Nonce/rate infrastructure dùng RAM hoặc Redis counter đã hash với TTL, không phải business memory.

**Có đường khác chưa đáp ứng mục tiêu không lưu nội dung trên server:** [plugin Memory bridge](../../plugin-server/gold-memory-bridge.mjs#L11) mã hóa JSON thành base64url trong shell script, gọi `adapter.exec` rồi parse stdout. Base64 không phải mã hóa bảo mật. [Executor job_started](../../operator-host/executor.mjs#L903) chứa script; [stdout events](../../operator-host/executor.mjs#L619) có thể chứa body Memory read. [Event writer](../../operator-host/executor.mjs#L439) ghi `operations.jsonl`; redactor hiện lọc một số credential patterns, không loại toàn Memory body/base64. Vì vậy có khả năng có bản sao request/read trong log bền ở server.

[Gold job ledger](../../lib/gold-job-ledger.mjs#L5) cố ý chỉ giữ metadata và bỏ script/stdout; điều đó không loại bản sao event log. Không được chỉ kiểm PG rồi kết luận toàn hệ thống không lưu nội dung. Nghiên cứu không đọc live log/DB và không khẳng định một nội dung cụ thể của Owner đang còn trên server; đây là đường persistence xác nhận từ source.

Ưu tiên cao trước mở rộng context/worker:

1. Phân loại rõ memory payload, transcript, worker prompt/result/artifact và metadata. Server được giữ routing/job/grant metadata cần thiết; body Memory không đi vào durable command script/stdout/event trace.
2. Thay Memory exec wrapper bằng typed signed/device-bound content operation hoặc kênh relay phù hợp, giữ local scope/Home/consent và ký checkpoint. Control plane chỉ mang opaque refs/hash/offset cần thiết; content plane có retention/TTL rõ. Không route arbitrary shell hoặc dùng Owner cookie thay quyền Agent.
3. Loại body **trước** mọi persistence/logging/telemetry, không chỉ che UI hoặc response. Chính sách áp dụng Plugin, Operator, reverse proxy, Redis/DB/event log, exception và export diagnostics. Worker kết quả/context tương lai phải đi cùng nguyên tắc; không đưa full prompt vào generic exec logs.
4. Dùng sentinel giả riêng cho save, list/get/full-context, sync và worker result; sau test tìm sentinel ở mọi kho log/DB/cache của môi trường cô lập. Xác minh ciphertext relay biến mất đúng TTL/restart, không sửa dữ liệu thật để chứng minh.
5. Bảo toàn log/backup lịch sử hiện hữu. Nếu sau này xác minh có nội dung cũ, xử lý retention/cleanup là tác vụ riêng có kiểm kê và quyết định Owner; nghiên cứu này không xóa gì.

Server relay không đồng nghĩa không có buffer tạm thời. Mục tiêu nghiệm thu là không có **bản sao nội dung bền** trên Light Remote server ngoài chính sách đã được Owner chấp thuận; client Home/replicas và nhà cung cấp AI có phạm vi lưu riêng phải mô tả đúng.

## Extension: hợp nhất source, thêm Claude và luồng khôi phục

Source hiện tại:

- [local v0.2.0 manifest](../../extensions/light-remote-lm/manifest.json): `127.0.0.1/localhost:5491`; pending TTL chủ yếu kiểm khi event chạy.
- [Lab v0.3.0 manifest](../../extensions/light-remote-lm-abv2/manifest.json), [background](../../extensions/light-remote-lm-abv2/background.js): `100.94.184.141:15591` cố định, có alarms dọn10phút.
- [capture.js](../../extensions/light-remote-lm-abv2/capture.js#L13), popup và validator chỉ cho ChatGPT. Capture đọc DOM đã load, không lấy hidden model context hoặc các turn chưa load; media/attachments/tool data không đầy đủ. Việc loại DOM ẩn theo ancestor/duplicate chưa được bảo đảm và cần kiểm thử. Lấy một markdown block và trim có thể thiếu nhiều block hoặc thay whitespace của code.
- Luồng hiện hành là bấm Capture → review → Chrome storage.session → stage textarea trên Wall → Owner chọn scope/opt-in/Save. Extension không tự POST Save, không auto-submit chat. Wall read context cũng chỉ đưa text về textarea; chưa có restore vào composer ChatGPT/Claude.

ZIP v0.3.0 `extensions/releases/Light-Remote-LM-GoldABV2-v0.3.0.zip`: 28,095bytes, SHA256 `76a3649a4fb7704cb930f4a1912f70b80d8387128f69aff023e9a306f3fd0dcd`. Bốn file executable manifest/background/capture/popup khớp source sau chuẩn hóa CRLF/LF. Chưa kiểm toàn archive byte-identical, chưa xác minh bản Owner đang cài. README Lab/identity mismatch là tài liệu lịch sử, không chứng minh enrollment hiện nay lỗi.

Đề xuất một extension chính thức và quy trình sau:

1. Dùng một source core và provider adapters `chatgpt.com`, `claude.ai`; capture chỉ khi Owner bấm, đúng tab/conversation. Báo provider, URL, timestamp, loaded turns, omitted content và coverage; không gọi DOM snapshot là toàn bộ hidden context của model.
2. Endpoint lấy từ manifest/catalog sản phẩm cùng profile hoặc cấu hình được xác minh; mặc định ưu tiên local Wall cùng thiết bị. Host permissions/optional permissions phải khớp allowlist, không mở arbitraryURL hoặc all_urls. Verify product/device/account trước staging; không rơi âm thầm từ local sang LabARM hoặc sang Owner/scope khác.
3. Capture text theo nhiều block/role, giữ code whitespace/Unicode. Preview/redact trước Save; không tự chọn Memory scope, bật full-context opt-in hoặc tự lưu background. Transcript là dữ liệu lịch sử không tin cậy, không trở thành lệnh/ủy quyền.
4. Hợp nhất TTL/session-alarm, clear-on-close/expiry/staged, giới hạn bộ nhớ và digest/segment validation. `maybePrepare` hiện có thể được gọi từ onUpdated và fast-load path; thêm claim/generation/single-flight trước staging để không hai lần ghi đè phần Owner đang chỉnh. Đây là race source cần tái hiện, chưa coi đã xảy ra.
5. Luồng **Restore context** riêng: Owner chọn checkpoint/scope của đúng account → xem summary/docs/provenance và dung lượng → copy hoặc stage composer đúng tab → Owner tự gửi. Không ghi đè draft đang soạn, không tự submit, không auto-continue ChatGPT/Claude conversation. Nếu selector không chắc, trả Copy thủ công.
6. Lấy context vừa đủ: checkpoint summary, quyết định, việc còn dở, đường dẫn/hash docs và nguồn; full transcript là opt-in. Worker hoặc Agent chỉ đọc nội dung trong scope đã cấp. Dùng manifest context để biết file/checkpoint nào đã nạp, không hứa bộ nhớ web model tự cập nhật chỉ vì đã Save vào Light Remote.

Không tạo extension mới bằng cách chỉ đổi tên Lab package; phải bỏ endpoint profile cũ có kiểm soát và nghiệm thu provider selectors/auth/staging/readback/restore thật.

## Codex: tự tải metadata và hiển thị usage có nguồn

### Vì sao phải bấm Check account?

Desktop [NativeModuleScreens.tsx:96](../../client/desktop-v4/src/NativeModuleScreens.tsx#L96) dùng `codex.read` → [device API](../../device-agent/desktop-device-api.mjs#L61) → cached `codexPlusView` → `plus.snapshot`. [snapshot](../../device-agent/gold-codex-plus.mjs#L240) chỉ refresh khi child đã chạy và account connected/login pending. Cold Agent chưa start child nên polling snapshot không bootstrap account/models. Check account mới gọi `account()` và khởi động app-server để đọc metadata. Đây là lifecycle/UX hiện hành, không đủ kết luận credential bị hỏng.

Wall có luồng khác: vào `/codex-cli` khi module bật có initial account refresh ở [local-wall](../../device-agent/local-wall.mjs#L1956). Không suy lỗi cold Desktop sang Wall khi chưa kiểm tra.

Đề xuất tách **metadata warmup** khỏi **khởi chạy công việc**. Khi Owner đã enable provider và runtime sẵn sàng, mở trang sẽ single-flight đọc account/model/quota một lần; không tự login, cài runtime, chạy task hoặc gọi inference. Có loading, offline, needs-login, last-known và retry. Provider chưa được chọn không tự khởi động.

### Refresh và quota

[refreshMetadata](../../device-agent/gold-codex-plus.mjs#L199) throttle30s, modelTTL60s; Check account và Refresh usage đều gọi `account()`→refresh không force. Timestamp được set trước RPC nên lỗi cũng có thể suppress retry30s. Explicit Refresh cần force đúng nguồn, single-flight/backoff và generation/account fence; polling nền dùng cache hợp lý. Không cộng thêm request liên tục khi tab hidden.

Hai ảnh Owner gửi: web còn69% tuần/app đã dùng31%; web còn100% ngắn hạn/app0% đã dùng. Các cặp này khớp toán học nếu cùng account/bucket/thời điểm, không phải bằng chứng inversion. Báo cáo Owner về các lần sai khác vẫn cần kiểm chứng, nhất là stale/reset/window/account. Không đổi thành `100-usedPercent` mà giữ nhãn đã dùng.

[session view](../../device-agent/gold-codex-session-view.mjs#L67) hiện giữ usedPercent/windowDurationMins/resetsAt; UI cũng render usedPercent trực tiếp. [OpenAI Docs](https://learn.chatgpt.com/docs/app-server) định nghĩa usedPercent là đã dùng trong window và resetsAt theo Unix seconds. Kế hoạch hiển thị đồng bộ Desktop/Wall: **còn X% / đã dùng Y%**, tên phạm vi quota đúng, source+asOf, reset tuyệt đối và tương đối, timezone, stale/unknown. Dùng limitId/window thực, không hardcode mọi tài khoản thành5h/7ngày.

Phân biệt bốn loại số liệu:

| Loại | Nguồn / cách trình bày |
| --- | --- |
| Quota của provider/account/bucket | Rate-limit source; phần trăm không suy ra từ token. Không có dữ liệu thì unavailable, không gán0% đã dùng. |
| Token tác vụ/worker trên máy này | Actual turn events, task/worker IDs, phạm vi process/session và thời điểm bắt đầu rõ; tránh cộng lại cumulative/resumed/subagent events. |
| Token account lifetime | `account/usage/read.summary.lifetimeTokens`, không phải số token còn lại. Số4,796,742,182 trong ảnh không tự chứng minh quota sai. |
| Budget của nhiệm vụ | Giới hạn time/turn/token/cost Owner chọn; cost có thể là estimate, không giả là provider quota hay chặn hóa đơn tuyệt đối. |

Token parser hiện đòi đủ5 trường; runtime thiếu một field có thể làm cả report unavailable. Version/schema adapter cần giữ phần đã biết và field unknown riêng, không đoán0. `ordinaryUsageAllowed` đã parse ở Agent nhưng Desktop projection bỏ mất; credit/extra usage và multi-bucket/partial-notification semantics cần đối chiếu runtime đã pin. Test empty multi-map/fallback, primary-only updates, out-of-order account changes và reset expired trước khi khẳng định các hypothesis là bug live.

Model catalog là catalog của runtime, không luôn chứng minh entitlement. Lưu requested/actual model và reasoning effort theo capability; không chạy inference ngầm để thử quyền chỉ vì mở trang. Account refresh/notification phải invalidation đúng account, không làm lộ cached dữ liệu của account trước.

## API Worker: tên chung, adapter và quyền riêng

Đổi **nhãn UI** Codex Bridge thành **API Worker** trên Desktop, Wall, trợ giúp và trạng thái. Giữ alias/module key `codexBridge`, DB/routes/paths cũ tương thích trong giai đoạn đầu; không mass-rename làm mất preference, module flag hoặc task cũ. Chỉ migrate storage/API khi có version contract và rollback riêng. UI phải nói rõ provider đang dùng CLI tài khoản đăng nhập hay API/cloud có billing riêng.

Mỗi provider có card riêng với checkbox chọn dùng; trạng thái installed/enabled/authenticated/ready/running tách biệt. Chọn provider không đồng nghĩa đã login hoặc có quota. Card gồm setup/runtimeversion, auth method, model, reasoning nếu hỗ trợ, workspace được phép, budget, diagnostics đã lọc và nút logout/remove cấu hình đúng scope. Không yêu cầu cài mọi provider.

| Adapter đề xuất | Auth và execution | Model/output/usage |
| --- | --- | --- |
| Codex local app-server | Giữ luồng chính thức có sẵn, tách auth status và work launch; đánh giá Sign in with ChatGPT mới nếu triển khai profile sản phẩm phù hợp | model/list, thread/turn lifecycle, rateLimits/usage; model availability cần xác minh khi thực sự chạy tác vụ. |
| Claude Code CLI / Agent SDK | CLI chính thức với login của người dùng; API/cloud adapter riêng dùng credential hợp lệ | Structured JSON/stream, supportedModels/canUseTool theo SDK/runtime; effort theo model. |
| Gemini CLI | Login qua CLI chính thức, headless theo version/capability; không trích OAuth để gọi backend tự xây | JSON/stream-json stats, model/thinking theo runtime; quota không được suy từ tokens. |
| Anthropic API, Gemini API/Vertex | Optional API adapters riêng, native vault/credential chain phù hợp, billing được ghi rõ | Capabilities/model catalog/provider errors/usage riêng; không giả subscription login là API key. |

Tài liệu được đọc ngày2026-11-11: [OpenAI app-server integration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server), [Claude SDK](https://code.claude.com/docs/en/agent-sdk/typescript), [Claude permissions](https://code.claude.com/docs/en/agent-sdk/permissions), [Gemini headless](https://geminicli.com/docs/cli/headless/), [Gemini authentication](https://geminicli.com/docs/get-started/authentication/).

Provider auth không phải một OAuth dùng chung: dùng luồng chính thức, không thu thập/chuyển subscription token sang custom backend. Điều kiện Claude về chạy binary nguyên bản và third-party login được nêu tại [legal/compliance](https://code.claude.com/docs/en/legal-and-compliance); Gemini lưu ý không piggyback CLI OAuth trong [FAQ](https://geminicli.com/docs/resources/faq/). Cần chốt adapter/auth hợp lệ trước khi thiết kế nút login, không tự copy token từ thư mục CLI. Secret không vào renderer, argv, prompt, activity log hoặc Memory.

Gemini policy `ask_user` trong headless là deny theo [Policy Engine](https://geminicli.com/docs/reference/policy-engine/); adapter phải báo blocked/needs-owner-action thay vì treo đợi prompt hoặc bật yolo. Claude dùng permission callbacks/rules khi runtime hỗ trợ. Không provider nào được nâng quyền hơn local policy; quota unknown vẫn có thể là dữ liệu chưa hỗ trợ, không đồng nghĩa hết quota.

## ChatGPT Web có thể gọi Codex hỗ trợ suy luận ngay chưa?

Current source có [observer read-only, delegated coding và review](../../device-agent/gold-codex-plus.mjs#L295), [supervisor](../../device-agent/gold-codex-supervisor.mjs#L38) và [coordinator](../../device-agent/gold-codex-coordinator.mjs). Owner có thể khởi chạy qua Desktop/Wall được authorize. Supervisor dùng một candidate, CAS lease, rounds1–5; chạy độc lập browser và DONE chỉ thành review_required. Review hiện đánh giá report/evidence được đưa vào, không mặc nhiên đã đọc code và kiểm chứng vật lý.

**Chưa có dedicated public MCP worker contract** trong Plugin tools/adapter/helper để ChatGPT Web submit reasoning job, đọc tiến độ/kết quả và cancel. Không dùng local Owner cookies hoặc gọi lén loopback API để bù. Legacy `gold-codex-api.mjs` còn source nhưng route Wall đã410; project-continuity RPC chỉ proposal/nonexecution, không phải engine multi-worker.

Đề xuất luồng dùng đúng ý định Owner:

```mermaid
flowchart LR
  W[ChatGPT Web hoặc Claude Web] --> M[MCP Light Remote]
  M --> C[Control plane job refs và grant]
  C --> L[Worker controller trên client]
  H[Long Memory và docs local đã chọn] --> L
  L --> X[Codex]
  L --> A[Claude]
  L --> G[Gemini]
  X --> R[Receipt và artifact local]
  A --> R
  G --> R
  R --> Q[Kết quả được phép đọc qua MCP]
  Q --> W
```

- Bắt đầu bằng **reasoning/review read-only**: Agent chọn provider/model và context refs đã cấp; nhận jobId/queued state, poll/read result, rồi tự tổng hợp và tiếp tục nhiệm vụ. Không tự đẩy turn vào ChatGPT Web. Read-only ở đây không có nghĩa không gửi context tới provider; context export cần nằm trong phạm vi Owner cho phép.
- Contract mới có start/status/events/result/cancel và capability discovery; tên/schema cụ thể sẽ được review khi implementation. Bind account/device/Agent session/grant/workspace/context snapshot/version; idempotency và receipts thật. Không chuyển Desktop Owner login thành Agent execution grant.
- Coding/edit là mode khác, workspace/sandbox/approval riêng. Provider prompt không thể mở thêm network, shell, filesystem hoặc nâng quyền. Approved task definition và local policy là giới hạn cuối.
- Result phân biệt completed/failed/interrupted/needs-owner/unknown; gồm summary, evidence refs, requested/actual model, scope, timestamps, usage và artifact manifest. Không coi recommendation DONE là project/task đã nghiệm thu.
- Worker outputs/prompt/context giữ ở client trong scope cần thiết. Server control metadata và content relay phải theo mục retention ở trên; không đưa toàn context vào command script/stdout của generic jobs.

## Multi-worker: khả thi, chưa có trong current implementation

Current plus giữ một child/currentTurn/working guard; supervisor có running boolean và LIMIT1. `CONTINUE_SECTION_B` là nhãn quyết định, không sinh workerB. Vì vậy không nên chỉ đổi UI thành multi-worker rồi cho là đã có scheduler.

Đề xuất một controller và provider adapters có interface capabilities/auth/model/launch/events/cancel/result. Mỗi worker có job/worker/parent IDs, provider account, role, context snapshot, budget và lease riêng. Concurrency được Owner đặt và hệ thống giảm theo CPU/RAM/quota; mặc định triển khai nhỏ, đo thực tế trước khi tăng.

Có thể chạy nhiều reader/reviewer song song trên snapshot immutable, **một writer/lease cho cùng workspace**. Kết quả là evidence/patch artifact để coordinator tích hợp; không cho nhiều worker sửa cùng file âm thầm. Branch/worktree mới vẫn theo quyền Owner hiện hành; kế hoạch này không cấp quyền tạo branch tự động.

Budget có mức per-worker và tổng tác vụ, giới hạn thời gian/turn/recursion và stop rõ. Một worker lỗi/hết quota không được tự chuyển provider/account với context chưa được cho phép. Chỉ cancel process tree của worker tương ứng, không dừng Agent/session khác; reconnect/crash không replay coding unknown. Scheduler cần CAS/fencing/recovery, không chỉ Promise.all.

Long Memory chứa checkpoint/context/artifact refs để chuyển session có chọn lọc. Không cho extension capture hay worker result tự thành lệnh điều phối; Agent chính quyết định sử dụng evidence và Owner giữ quyền xác nhận trạng thái hoàn thành/các thao tác đã yêu cầu duyệt.

## Lộ trình và kế hoạch test — chưa chạy

| Bước | Kết quả cần có | Kiểm thử có ý nghĩa |
| --- | --- | --- |
| 1. Retention và contract | Đóng đường MCP Memory body vào script/stdout/event log; một extension/profile chuẩn; provider boundary | Sentinel qua Memory save/read/full-context/sync; payload không xuất hiện trong log/PG/Redis ngoài buffer TTL được định nghĩa; kiểm crash/restart. |
| 2. Extension capture/restore | ChatGPT và Claude adapters, coverage/digest, TTL, single staging, manual Save/Restore | DOM fixtures nhiều block/code/Unicode/hidden/virtualized/oversize; fake Chrome alarms/tab lifecycle; duplicate onUpdated không ghi đè redaction/draft. |
| 3. Metadata/usage UX | Auto warm enabled provider, explicit force refresh, timestamp/scope/unknown và account invalidation | Cold Agent đã login; offline/expiredlogin; request within30s; reset passed; used/remaining; partial token fields, multi-bucket/stale/accountswitch. Không inference để test metadata. |
| 4. Một worker qua MCP | Read-only reasoning job end-to-end trên exact device/session/context | Structured stub trước; rồi Owner cho phép một live provider call có budget, poll/cancel/results và không dùng loopback bypass. |
| 5. Claude/Gemini adapters | Setup từng provider, official login/API options, model/usage/approval capabilities | SDK/CLI version fixtures; auth unavailable/quotaunknown/headlessdeny; một live job nhỏ từng provider sau khi Owner chọn tài khoản và ngân sách. |
| 6. Multi-worker | Bounded scheduler/readers/writer lease/recovery/artifacts | Readerparallel, writerconflict, budgetsum, crash/lateevent/fencing/cancel đúng process; no replay/double usage, context/account isolation. |

Node selftests hiện có là nguồn test nền: `selftest-gold-lm-extension-abv2.mjs`, các `selftest-gold-memory-*`, `selftest-gold-codex-plus.mjs`, supervisor/coordinator và Desktop CodexControls tests. Chưa chạy trong nghiên cứu; không suy source test tồn tại thành PASS. Mọi thay đổi implementation cần meaningful isolated tests và exact-source CI theo AGENTS ở lượt được yêu cầu.

Physical Chrome acceptance riêng: load unpacked trong profile test → login đúng local Wall → bật Memory/chọn scope/opt-in → capture câu chuyện ChatGPT/Claude giả → review/redact/manual Save → readback checkpoint ký → sync client thứ hai đã cấp quyền → mở chat mới/manual Restore → xác minh nội dung và draft không mất. Test logged-out redirect/module-off/CSRF/cross-account/Home mismatch; không auto-select scope hoặc gửi chat. Không cài/đổi extension trên profile Owner trong nhiệm vụ hiện tại.

Mọi test live worker phải có provider được chọn, auth sẵn có hợp lệ và budget cụ thể; không login/cài CLI hoặc tiêu quota chỉ để nghiên cứu. Native installer/tray/X/Agent/ConPTY/upgrade/rollback dev6 và [RMv2 typing/cursor/GPU plan](RMV2_RESPONSIVENESS_CURSOR_GPU_PLAN.md) vẫn là backlog riêng cho lần build được Owner yêu cầu; không bị bỏ khỏi checkpoint.

## Kết quả nhiệm vụ nghiên cứu

Đã có source map, lỗi/gap rõ, ranh giới retention và thiết kế extension/API Worker/multi-worker/test. Chưa đổi nhãn UI, thêm provider login, sửa account refresh, extension hoặc worker implementation. Chưa có Chrome/provider/native physical test hay benchmark mới. Last verified Lab vẫn8e0d932/dev5, main8ac6273 và máy Owner không đổi.

Chỉ docs/checkpoint gates được chạy khi xuất bản kế hoạch. RMv2 typing đã xuất bản riêng ởad3db2f, CI76 documentation-only PASS; core/Desktop/Windows/native dependency jobs skipped. Sau khi Owner yêu cầu triển khai, ưu tiên retention + một extension chuẩn + metadata UX, sau đó một MCP reasoning worker trước khi mở nhiều provider/worker song song.

## Mốc triển khai P1 — 2026-11-15

Implemented typed MCP Memory transport, current exact A/B/grant checks at admission, signed device fetch/push and result read. RAM relay64requests/8MiB/120s absoluteTTL; no file/PG/Redis dependency in content plane. Device uses existing module/identity/Home checks and atomic SQLite save+dedupe receipt. Clear-local erases receipt content and keeps an operation tombstone to prevent old saves reappearing. Unknown replies never retry a write automatically. Historical logs/backups untouched.

Isolated Node tests9/9 plus7 existing Memory/endpoint/core-import regressions PASS. Sentinel tests traverse actual typed device handlers, result sanitizer and real PG ledger serializer with an instrumented pool; they are not an inspection of Owner logs or a deployed production PG acceptance. Native/Chrome/provider physical acceptance and full exact-source CI remain separate. Research findings above describe the old source at audit time, not the new P1 source.

## Mốc triển khai P2 — 2026-11-15

Implement P2 canonical Memory extension0.4: explicit local/approved NetBird Wall pairing to account/device; optional exact-origin permission and activeTab-only ChatGPT/Claude adapters; loaded-DOM coverage, hidden-ancestor exclusion, multiple blocks/code whitespace and UTF8/hash guards; reviewed capture stages only into an empty authenticated matching Wall. Generation/single-flight and absolute TTL prevent duplicate/stale draft overwrite. Restore reads selected-work verified context/history, rechecks identity/scope and full-context hash, then reviews/copies or inserts into a uniquely identified empty ChatGPT/Claude composer without submitting. Preserve existing drafts. Package app Google Sans and license; Actions generates a separate exact-source ZIP. Old0.2/0.3 sources/artifact remain historical.

Portable extension VM tests10/10 PASS plus packaging/permission guard PASS. Covered ChatGPT/Claude Unicode multi-block capture, hidden parent, changed capture digest, endpoint validation, reviewed-content hash, Wall identity/expiry/draft fences, full-context hash and account drift, restore draft preservation/no submit, repeated navigation single-flight, generation race and pending/restore TTL erasure. Real Chromium two-provider DOM fixtures and source/hash ZIP packaging are wired to exact-source CI but not yet run. No claim of actual provider website/Owner Chrome installation or cross-device sync acceptance. Full pre-change checkpoint checkpoint/20261115-before-rmv2-memoryextension-0e4df88 restore/fsckPASS. P1 CI134 has core/contracts/PG/Redis, native dependency/helper, web QA and Linux/macOS desktop PASS; remaining stress/installer/baseline pending at this receipt.

No Owner Chrome installation/profile modification, provider login/inference, Gold/production runtime change, DB migration, feed/main/domain/callback change or Owner Windows install. Gold and installed Owner helper remain dev12 source2b65a37; dev13 candidate source is not deployed.

## Mốc triển khai P3 — 2026-11-15

Implement P3 API Worker display/navigation rename with /api-worker aliases while preserving codexBridge module keys, old routes, tasks and preferences. Enabled installed Codex warms account/models/quota metadata without login/install/inference; manual account/usage refresh forces fresh reads. Per-field success TTL/backoff, single-flight, bounded model pagination and account-generation fences reject late cross-account metadata. Show reported allowance remaining plus used, actual windows/reset timezone/received times; merge bucket notifications without erasing other windows. Preserve partial token fields as unknown and count only owned reported subtotals. Disable automatic metadata when provider/module is off. Include P2 Chromium synthetic fixture UTF8 declaration correction without weakening Unicode/code whitespace assertions. Claude/Gemini adapters, MCP reasoning jobs and bounded multi-worker are still pending.

ARM isolated Node metadata/session/native API suite16/16 PASS plus4 existing official Codex/mock-CLI, coordinator, supervisor and core-import scripts PASS. No real provider auth/inference. React tests added for remaining63/used37 and partial fields; exact-source frontend/browser/native CI pending. Reviewed React skill checklist: deduped read poller, no inference from effects, account epoch fences, bounded reads, live select options and accessible controls. P1 source0e4df88 full CI13443691579319 all15 jobs PASS, including actual PG/Redis integration, five native text fixtures, web, Windows installer and Linux/macOS; artifact bytes not independently verified and no physical acceptance. P2 CI13543693120042 core/PG/Redis/helper and five text fixtures PASS; web failed at synthetic Unicode assertion. Fixture lacked UTF8 HTTP/meta declarations; corrected here and diagnostic capture retained, browser retest pending. Legacy selftest-gold-codex-api HTML API-key assertion also fails unchanged cad2c4f (input already absent), is not registered in portable suite, and is not treated as a P3 regression. Full pre-change checkpoint checkpoint/20261115-before-rmv2-apiworkermetadata-cad2c4f restore/fsckPASS.

Official API checked2026-11-15: [Codex app-server](https://learn.chatgpt.com/docs/app-server) reports usedPercent, actual windowDurationMins and Unix-second resetsAt, with multi-bucket read and single-bucket updates. Remaining is displayed as100-used, with per-window receive timestamps; no fixed5h/7day assumption. Partial token fields stay nullable. This source/format correction is not independent acceptance of a real provider quota against ChatGPT Web.

No runtime/Gold/production update, Owner Windows/Chrome installation, provider login/inference, historical log cleanup, DB migration, main/feed/domain/Google callback change. Deployed Gold/installed Owner helper remain2b65a37/dev12; dev13 current source awaits full exact CI and artifact verification.

## Kiểm tra lại extension và điều hướng — 2026-11-20

Read plain text from simple editor paragraphs during context restore. Chromium innerText adds a visual blank line between paragraphs, which previously made a correct insert look incomplete. Verify Unicode, indentation and actual newline boundaries in both provider fixtures. The Wall regression now checks navigation to /api-worker and Owner authentication on both /api-worker and /codex-cli.

Isolated Windows Chrome headless fixtures PASS for ChatGPT and Claude. Existing ten extension unit tests and the Wall navigation regression PASS. CI136 at 3b052d1 failed the old navigation expectation in Core and Windows and the editor readback in Web. Corrected source needs its own CI and artifact verification. Full checkpoint checkpoint/20261115-before-rmv2-apiworkerreasoning-3b052d1 restored and passed fsck.

Gold Lab and Owner Windows remain on dev12 source 2b65a37. Physical Chrome and provider acceptance are pending.

## API Worker review pilot — 2026-11-20

Add the API Worker pilot for text review through MCP. The calling Agent uses one UUID for a request and can read progress, retrieve the result or cancel it. Local Wall shows the exact text, model and timeout before approval. Each request is scoped to the active account, device, A/B Agent, session, grant and connection. Codex receives one review turn through the existing ChatGPT sign-in and a restricted read-only sandbox request. Hub content is transient and SQLite stores content-free receipts on the device. The pilot defaults off.

Synthetic verification covers the real Fleet queue, Operator route handlers, the device queue and mocked Codex app-server. Covered authorization changes, cancellation and late replies, required local approval, content-free job records, restart without replay, module and CSRF guards, and the existing Long Memory and Codex flows. Real provider compatibility and inference are pending. CI137 Core and Web passed on 8513717. Full pilot Actions checks pending. Pre-pilot checkpoint checkpoint/20261115-before-rmv2-apiworkerpilot-8513717 restored and passed fsck.

Gold Lab and Owner Windows are on dev12 source 2b65a37. The dev14 pilot is a source candidate and remains disabled.

The pilot uses LIGHT_REMOTE_API_WORKER_PILOT=1 in the Plugin, Operator and device Agent in a test environment. It requires dev14 and the local API Worker module. The local review expires after five minutes. One active review can run on a device. Text lives in device RAM for the review and for up to 15 minutes after completion. The client keeps the UUID and digest receipt to prevent replay. The 4,096-receipt ceiling intentionally refuses new jobs when full. The time and turn limits bound the local review. Provider billing and quota come from the signed-in account. The current input is an explicit text snapshot supplied by the Agent and checked by the Owner. Automatic Long Memory reference loading, provider CLI setup, desktop review controls and multi-worker are later steps. Runtime schema follows [App Server](https://learn.chatgpt.com/docs/app-server) and [ThreadStartParams](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/ThreadStartParams.json).

## Tùy chọn Claude và Gemini trên thiết bị — 2026-11-20

Add separately selectable Claude Code and Gemini API providers to the API Worker review pilot. Desktop and Local Wall share device-local provider choices. Connection checks inspect local Claude auth or Gemini model access without inference. The queue continues to require approval of the exact text and model before each provider turn. Claude uses an Owner-installed official CLI and its sign-in. Gemini uses an explicitly configured AI Studio API key with separate quota. Provider keys and local account details are excluded from Desktop, Wall and MCP metadata.

Windows portable provider and Desktop API tests 9/9 PASS. The fake Claude process checks stdin, fixed review flags, and exclusion of ambient credentials. The fake Gemini transport checks official endpoint, header authentication, model lookup, no tools, partial usage, and quota/truncation errors. Wall navigation, Owner/CSRF guards, Windows core import closure and the prior review queue tests PASS. Real provider executions are pending. CI137 at 8513717 passed 15/15. CI138 at fa972a1 passed Core and Web. Its Windows job failed at the RM test fixture pipe connection before typing began. No Windows pilot installer is eligible from CI138. Current source needs its own CI. Pre-change checkpoint checkpoint/20261115-before-rmv2-apiworkerproviders-fa972a1 restored and passed fsck.

For pilot testing, configure the Worker Agent with LIGHT_REMOTE_API_WORKER_CLAUDE_BIN (absolute official CLI path), LIGHT_REMOTE_API_WORKER_CLAUDE_MODEL, LIGHT_REMOTE_API_WORKER_GEMINI_KEY and LIGHT_REMOTE_API_WORKER_GEMINI_MODEL as applicable. Provide the Gemini secret through the device process configuration and keep it out of source, logs and browser forms. Use the official Claude Code sign-in on the Worker device, then select only the providers to allow. The Claude adapter checks the 2.1 CLI protocol at patch 318 or newer and supports the Claude subscription profile for the pilot. The Gemini profile uses the AI Studio API key supported for third-party tools and the same kind of key accepted by Gemini CLI. The Local Wall stays the approval screen for agent requests. Read-only account connection checks carry no review text. [Claude CLI options](https://code.claude.com/docs/en/cli-reference), [Claude authentication requirements](https://code.claude.com/docs/en/legal-and-compliance), [Gemini integration guidance](https://geminicli.com/docs/resources/faq/), [Gemini API](https://aistudio.google.com/api-reference/generate-content).

## Review song song và checkpoint Long Memory — 2026-11-20

An authorized MCP Agent can request two independent text reviews of the same snapshot on one device. Use the same optional workGroupId for both requests and a separate workerId per review. Each exact review still needs Owner approval in Local Wall. The controller runs at most two reviews concurrently, one per provider. Both the group reservation and the concurrent device budget are capped at 120 seconds. An explicit Long Memory checkpoint reference resolves on the device and is checked against the active scope and signed checkpoint before the provider call and before returning its result. Group reservations and replay fences survive restart as metadata. Cancellation and result lookup stay bound to the individual worker.

Pilot smoke test: read capabilities, choose two configured providers, and submit two requests with one common workGroupId, two different workerId values and one explicit memoryCheckpoint with scopeId and checkpointId. Omit context when using the checkpoint reference. Review the actual resolved text in Local Wall, then approve each worker. Poll status or events per worker and fetch each result. Test cancelling just one worker in a separate run. Use fresh IDs for new tasks and the original IDs when retrying transport. Use a new group only for a deliberate new review. Old dev14 pilot builds support single review with explicit text. Use a build from this source or later for group and checkpoint fields. The group budget measures reserved run time. Provider quotas and reported token usage remain provider-specific. Multi-provider workspace writes are outside the review pilot.

35/35 Windows portable Node tests passed, covering signed checkpoint resolution, archive fencing, group limits, independent cancellation, replay prevention, metadata, typed Memory relay and synthetic MCP dispatch. Desktop TypeScript and Vite web build passed on the same frontend tree, with 130/130 Vitest tests. CI137 at 8513717 passed 15/15. Its extension artifact is published; the ZIP bytes and actual ChatGPT/Claude Chrome installation remain unverified. CI138 Core and Web passed; Windows install smoke failed connecting to its native text fixture before sending input. CI139 for 12c4861 was pending when preparing this receipt. This source needs its own baseline run. Pre-change checkpoint checkpoint/20261115-before-rmv2-apiworkerparallel-12c4861 restored and passed fsck.

Check the exact-source baseline and verified artifact manifests. Use a separate Chrome profile for real ChatGPT/Claude capture, manual save, sync to a second authorized device and restore in a new chat. Confirm one bounded review per configured provider, then two approved reviews of a single checkpoint through MCP on a test device. Use provider accounts and usage budgets selected by the Owner. The separately approved Codex workspace workflow remains the route for code changes.
