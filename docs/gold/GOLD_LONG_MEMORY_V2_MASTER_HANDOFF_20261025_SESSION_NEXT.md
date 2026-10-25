# LIGHT REMOTE GOLD — LONG MEMORY V2 / CODEX BRIDGE
# MASTER HANDOFF — CHUYỂN SESSION NGAY (25/10/2026, Asia/Ho_Chi_Minh)

> **START HERE.** Đây là handoff độc lập cho session tiếp theo, gồm kết luận hiện hành + phụ lục đầy đủ từ Master Plan và G3 acceptance. Phải phân biệt **SOURCE/CI PASS**, **LIVE UAT PASS**, **NOT DEPLOYED**, **BLOCKED**. Các phần phụ lục cũ là lịch sử; khi xung đột, phần "CURRENT TRUTH" bên dưới và xác minh read-only mới nhất được ưu tiên. Không suy luận rằng một build CI xanh đồng nghĩa triển khai thành công.

## 0. COPY/PASTE PROMPT DÀNH CHO SESSION MỚI

> Tiếp quản Light Remote Gold Long Memory V2. Đọc kỹ toàn bộ \`docs/gold/GOLD_LONG_MEMORY_V2_MASTER_HANDOFF_20261025_SESSION_NEXT.md\` trong repo \`n8n2erpnext/light-remote-mcp\`, branch \`feature/gold-m6-integrated-20261023\`. Đối chiếu GitHub HEAD, CI, Windows \`DESKTOP-VA16D27\`, Linux LXD \`light-remote-gold-uat\` trước khi làm. GitHub source mới nhất tại thời điểm bàn giao là \`20b584c\`, nhưng 2 Agent live vẫn ở \`99b1d2f\`, scoped Memory rev6/ACK6/6. Tiếp tục G3 Manual Replica→Home **real E2E**, sau đó full disconnect/reconcile. Tuyệt đối không thay Gold production, không lách sandbox sudo, không buộc nhập IP/NetBird URL/JSON/fingerprint ở UI. Nếu host ARM không authorized, làm A/B pairing chính thức. Đừng tự ý chạy test explosion hoặc ghi sai scope; ghi receipts/handoff sau từng gate.

## 1. CURRENT TRUTH — ĐÃ XÁC MINH TRỰC TIẾP

| Trạng thái | Giá trị |
|---|---|
| Ngày bàn giao | 25/10/2026, múi giờ Asia/Ho_Chi_Minh |
| Repo | https://github.com/n8n2erpnext/light-remote-mcp |
| Branch canonical | \`feature/gold-m6-integrated-20261023\` |
| GitHub HEAD | \`20b584c45376aee84e829d433eab51735af50406\` |
| Mô tả HEAD | \`feat(gold): durable signed Manual Replica event release\` |
| CI của HEAD | **4/4 SUCCESS**: Windows, Linux, Gold Native Wall Parity, Gold G3 Operator |
| Mã đang chạy trên Gold UAT | \`99b1d2fd3dbdd54c7f34b88033ba159e4560e8b2\`, **CHƯA** nâng lên \`20b584c\` |
| Mã đang chạy trên Windows | \`99b1d2f\`, **CHƯA** nâng lên \`20b584c\`; Windows Agent Task Running |
| Gold UAT | LXD \`light-remote-gold-uat\`, **4/4 systemd services active** |
| Thiết bị Home ARM | \`dev_e68276c691ba5413f42d5dde\` |
| Thiết bị Windows Replica | \`dev_8d0715fce77efffce4c5ed28\`, \`DESKTOP-VA16D27\` |
| Synthetic scoped E2E | \`d5e57c01-8864-4995-a186-01de2514ba79\` |
| Home revision / Windows ACK | **6/6**, exact matching hash \`456b287151e86121f33a934f0a101cc4aa7e9f62318b0cefc0daa811ea4a2aa0\` |
| Manual Replica-origin candidate | Source regression + staging **103/103 PASS**; UAT real **OPEN** |
| New Windows EXE | Verified SHA-256, already staged, **NOT installed** |
| Owner Account policy | Historical last mode read: global Sync ON, both ARM/Windows selected Auto, policy revision 14 **historical only**. Fetch current before mutation. |
| ARM host authorization | Production \`@light-remote\` target \`direct-arm-local\` currently returns \`agent_client_device_not_authorized\`. Gold UAT guest \`gold-uat\` has \`NoNewPrivileges\` and **cannot sudo root**. |
| Production Gold | **UNCHANGED**, không thay đổi. |

**Quan trọng:** Candidate GitHub \`20b584c\` có đủ CI xanh nhưng *không* có bằng chứng live Manual Replica→Home. Không được ghi "G3 Manual cả hai chiều PASS" trước bài thử cuối.

## 2. PRODUCT CONTRACT OWNER ĐÃ KHÓA

Long Memory & Codex Bridge **hai module tùy chọn độc lập**, có thể ON/OFF từng cái; cả hai OFF không được ảnh hưởng Light Remote chính (Account, Device, Operator, Plugin, Wall, Fleet, PTY/ConPTY, SCP, Filesystem roots, Admin, Support, Real Remote). Không dựng thêm app "Continuity", Account, Wall hoặc LXD thứ hai.

Wall Gold **English native admin**, danh sách thiết bị đã enroll theo **Light Remote Account**, Account Sync ON/OFF, checkbox selected từng device, và **selector độc lập ngay sau từng device**: \`Auto / Follow Project / Manual\`.

- **Auto:** scope được owner cấp quyền đồng bộ tự động.
- **Follow Project:** CHỈ project/workspace có binding xác thực, không đoán path/tên project trên máy khác.
- **Manual:** vẫn lưu verified local events vào SQLite, chỉ gửi khi chủ tài khoản bấm \`Sync now\`. Lượt sau không được nhập lẫn vào lượt trước; OFF/deselect/mode switch phải hủy quyền Manual cũ.
- UI chỉ báo Synced khi có signed scope revision + full hash + ACK hợp lệ. Không báo synced vì toggle ON, kết nối online hoặc ciphertext queued.
- Không yêu cầu người dùng nhập \`Home NetBird URL\`, IP, fingerprint, copy JSON/invitation. Route P2P/direct/relay no-store E2EE do Gold tự xử lý.
- Dark/cyan-blue style của Gold, giữ nguyên toàn bộ UI quản trị sản phẩm, icon và quyền filesystem roots.

**Datastores:** PostgreSQL 17 + Redis 8 canonical backend Account/Auth/device/policy/jobs. SQLite local chính thống cho scoped Long Memory, signed ledger, outbox, grants, ACK. Không đưa private keys, plaintext memory hoặc full chat transcript lên Operator/PG/Redis/cloud. JSON/SQLite không được thay thế PG runtime Gold.

## 3. KIẾN TRÚC BẢO MẬT VÀ SYNC

Một **authoritative Home per scope/epoch**, Ed25519-signed checkpoints. Replica không thể tự làm Home; event từ Replica có chữ ký thiết bị + X25519 ephemeral/HKDF/AES-256-GCM E2EE. Home kiểm tra đúng account, enrolled device, scope membership, active grant, epoch, signature, replay và idempotency, rồi transaction ghi signed Home checkpoint. Chữ ký event ACK và Home-to-Replica checkpoint ACK là hai gate khác nhau. Relay Operator chỉ luân chuyển **transient ciphertext**, không lưu/decrypt body.

\`Follow Project\` trên Replica cần owner-explicit binding **tại chính device** và active Home grant. \`Auto\` source adapters chỉ quan sát **verified successful native FS write/edit/mkdir/delete** hoặc **real Git HEAD transition**, không thu script/stdout/file content/path/credentials. Event ref bền vững dựa authenticated command ID để retry không ghi trùng.

**Manual Replica code mới:** signed Account \`manualRequestSeq\` odd = approved one-shot, even = disarmed; mode/account changes vô hiệu hóa lượt cũ. Khi Replica lần đầu thấy odd seq, lưu SQLite \`lm_evidence_manual_release\` snapshot high-water \`MAX(rowid)\` trong outbox; chỉ event đã tồn tại lúc đó thuộc lượt này. Mỗi frame nhận signed \`manualRelease\` proof (account/device/scope/eventId/Home epoch/grant/seq). Home bắt buộc proof khớp current Account policy và đúng chữ ký. Đây **đã PASS source tests, chưa live**.

**Caveat kỹ thuật:** high-water rowid dựa trên outbox append-only; nếu sau này prune/VACUUM/reuse rowid thì chuyển sang frozen event-ID manifest trước khi bật retention xóa rows.

## 4. SOURCE, ROLLBACK, THIẾT BỊ, ĐƯỜNG DẪN

- Repo canonical: \`n8n2erpnext/light-remote-mcp\`, branch \`feature/gold-m6-integrated-20261023\`.
- Gold ARM development worktree: \`/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/gold-m6-integrated-20261023\`.
- ARM LXD Gold UAT \`light-remote-gold-uat\`; candidate current: \`/opt/light-remote-gold-uat-candidates/99b1d2fd3dbdd54c7f34b88033ba159e4560e8b2\`.
- 4 UAT services: \`light-remote-gold-operator.service\`, \`light-remote-gold-plugin.service\`, \`light-remote-gold-process-supervisor.service\`, \`light-remote-gold-wall.service\`. Check \`systemctl is-active\` + actual \`ExecStart\`.
- UAT Wall NetBird route dành cho kỹ thuật: \`http://100.94.184.141:5591/\`; **ARM host :5491 là production**, tuyệt đối không đụng production. Địa chỉ này KHÔNG thuộc UI người dùng.
- UAT snapshot lịch sử: \`gold-before-codex-acl-and-sync-status-20261025\`, \`gold-before-g3-replica-evidence-20261025\`, \`gold-before-replica-autocapture-20261025\`. **Snapshot mới trước cutover \`20b584c\`.**
- Rollback tag bất biến: \`gold-restore-before-memory-codex-20261024\` => \`ba579f8830a0654e8321204f17270db8d94c5593\`, owner Windows baseline #486. **KHÔNG retarget/delete.**
- Windows local source Git: \`%LOCALAPPDATA%\Light Remote\G3-Account-UAT-387498d\source\`. HEAD \`20b584c\`; trước đó commit \`21c9b7d\` chứa handoff revision-6.
- Windows **đang cài** stable \`99b1d2f\` ở \`%LOCALAPPDATA%\Programs\Light Remote MCP\`, task \`LightRemoteDeviceAgent\` Running.
- Windows **chưa cài** \`20b584c\`, nhưng installer verified ở \`%LOCALAPPDATA%\Light Remote\Gold-UAT-20b584c\installer\Light-Remote-MCP-Setup-x64.exe\`; SHA256 \`e0b2165dd36a00d99f810a775dc1a427af5915861e04c7635bf539387f4cb0e5\`.
- Windows CI ZIP \`windows-20b584c-artifact.zip\` trong cùng folder, 328,467,088 bytes, SHA256 \`4cbea3c6cba8d222518f80afa2ea52151df6f4cdd9756517d67a56e6e0c09bea\`. GitHub artifact \`12593177463\`.
- Windows prior backup \`%LOCALAPPDATA%\Light Remote\Gold-UAT-99b1d2f\backup\installed-client\`; **take new backup** trước installer. Windows cùng AppId với client đang dùng, cài đè có thể tạm drop session.
- \`@light-remote\` ARM host device \`direct-arm-local\` cần A/B pairing lại chính thức (last \`agent_client_device_not_authorized\`); \`@light-remote-gold\` guest UAT user \`gold-uat\` không thể vượt \`NoNewPrivileges\`. Không lách sudo, không ghi vào root-owned candidate qua Gold guest sandbox.

## 5. PASS/OPEN GATE MATRIX

| Gate | Status hiện tại |
|---|---|
| G0 baseline/restore Gold integrated | PASS |
| G1 scoped Home Ed25519 / per-project isolation | PASS |
| G2 Auto Home checkpoint + restart | PASS |
| G3 Account device directory / per-device modes / English Wall | PASS nền tảng |
| G3 Home→Windows Auto E2EE ACK | PASS LIVE |
| G3 Home→Windows Manual \`Sync now\` | PASS LIVE |
| G3 Follow Project unbound deny / verified bound allow | PASS LIVE |
| G3 Windows→Home typed E2EE event + reflected Home signed checkpoint | PASS LIVE |
| G3 Gold Home Wall offline 95s → reconnect, durable outbox | PASS LIMITED LIVE (không phải full network/host outage) |
| G3 Automatic Windows Git HEAD source → Home | PASS LIVE |
| G3 Automatic native Windows filesystem source → Home | PASS LIVE |
| **G3 Manual Replica-origin → Home E2E** | **SOURCE/CI PASS; LIVE NOT YET** |
| Full device/IP/network outage + divergent replica reconciliation | OPEN |
| G4 complete P2P/NAT/no-store relay fallback | PARTIAL, not signed off |
| G5 full fresh ChatGPT conversation V2 scoped restore | OPEN (V1 HMAC handoff tested separately) |
| G6 macOS/Linux Desktop packaging/parity | OPEN |
| Optional Windows Codex app-server | \`codex_home_permissions\` fixed; \`codex_binary_missing\` OPEN |

## 6. LIVE RECEIPTS — ĐỪNG TEST LẠI VÔ ÍCH

Synthetic G3 scope **\`d5e57c01-8864-4995-a186-01de2514ba79\`**, Home ARM, Windows Replica:

| Signed Home rev | Live gate | Receipt |
|---|---|---|
| 1 | Follow Project scope unbound | Windows không nhận — correct negative gate |
| 2 | Owner explicitly verified workspace binding | Windows received signed rev2; Home ACK 2/2 |
| 3 | Windows typed E2EE event, then Home→Windows mirror | Event \`215d1dc4-9e5b-4d1e-9590-419b2fd49f16\`, hash \`3faadac30eeff0e10085805df9295b2cf4c8745daec2acbd7fcc28212ea788fb\`, ACK 3/3 |
| 4 | Gold UAT Home Wall offline 95-second scheduled autorestart | Windows queued event \`a07703a6-b017-46c6-9b93-8ede9a319860\` pending; after reboot signed hash \`2586478bfed2d11ec62cf80d6449f575b7bcbf9504451f4095b10deb12c4d0de\`, ACK 4/4 |
| 5 | Authenticated Windows Agent real Git HEAD change | Windows commit \`11d92337d9e9572b4f7708a85aeda3bfc30bb83c\`, event \`25d63714-7156-52b3-a629-c36c54727a6d\`, Home hash \`212639e52e72173beabbfe3a551270b4ca393b38d02555ab441b8d15a03ca056\`, ACK 5/5 |
| 6 | Authenticated native \`light_remote_write_file\` (synthetic file in owner-bound Windows UAT repo) | event \`8f0f5201-a5d2-5da4-a518-b7b971de7520\`, source \`gold-agent:native-fs\`, Home hash \`456b287151e86121f33a934f0a101cc4aa7e9f62318b0cefc0daa811ea4a2aa0\`, ACK **6/6** |

Ngoài ra:
- G2 Home auto scope \`7a0426e2-ef34-45de-a0be-31adefc0ef48\`, checkpoint \`5ed8292a-dc53-4329-b7ec-f1ac677a5a20\`, revision 1 signed Ed25519 after ~90s coalesce, persisted restart.
- V1 cross-session MCP HMAC checkpoints \`3c643f8a-1484-4a5c-8043-5746a3782850\`, \`a96f1652-4a87-4ffc-bc06-abf13f817538\`, \`353b1231-e27e-4ffc-9004-8200a0686cda\` with \`device_hmac_verified\`; **không phải V2 G5 full proof**.
- Home→Windows Manual earlier: held rev3 while mode Manual, owner requested Sync now, Windows accepted revision 3 and Home ACK 3/3.
- Last read-only verification **ngay trước handoff**: Gold UAT 4/4 service active; \`lm_heads\` and \`lm_replica_ack\` **[6, same full hash]**; Windows Agent Running.

## 7. CANDIDATE \`20b584c\` — THAY ĐỔI CODE/TESTS

Commit: https://github.com/n8n2erpnext/light-remote-mcp/commit/20b584c45376aee84e829d433eab51735af50406

- **New:** \`device-agent/gold-memory-manual-evidence.mjs\`: \`manualEvidenceCap\`, \`signManualEvidenceFrames\`, \`verifyManualEvidenceRelease\`.
- \`gold-memory-evidence.mjs\`: queue outbox cap \`maxRowid\`, Manual signed proof validation, E2EE signature compatibility.
- \`gold-wall-modules.mjs\`: mode-aware pending evidence, signed frames, Home current-seq validation.
- \`operator-agent.mjs\`: Manual sender only releases approved snapshot batch; Home checks mode/seq.
- \`operator-host/gold-memory-account-sync-policy.mjs\`: odd=request armed, even=disarmed, revoke old authorization on Sync OFF/deselect/mode switch; PostgreSQL migration 036 as-is.
- \`client/core-files.json\` and Windows CI manifest updated to **103 core files**.
- Tests \`selftest-gold-memory-replica-evidence.mjs\`, \`selftest-gold-memory-device-modes.mjs\`: signed proof tamper reject, wrong seq reject, post-snapshot hold, restart cap persistence, dedup, OFF/Auto→Manual invalidation and PG Account CAS.
- Local Windows source PASS syntax + regression + **103/103 staged files**; CI Windows + Linux + Parity + Operator **all SUCCESS**.
- **Caveat:** outbox high-water \`rowid\` correctness requires append-only outbox (purging/reuse needs fixed event-ID manifest). Không gọi source test "live UAT".
- Windows official CI https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40177333957 ; Linux https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40177333935 ; Wall https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40177333944 ; Operator https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40177333915 .

## 8. SESSION NEXT — THỰC HIỆN CÓ GATE / KHÔNG LÁCH QUYỀN

**A — READ ONLY FIRST**
1. Load this handoff, Master Plan appendix and G3 detailed appendix; check branch HEAD and CI.
2. \`@light-remote-gold\`: context explicit device ID for ARM UAT & Windows; read current source/installed manifest/4 services/Memory signed Home 6/6/Account policy current revision. **Không assume** policy revision 14 còn đúng.
3. Dùng \`@light-remote\` cho ARM host: nếu chưa authorized, owner mở Local Wall đưa **A code**, gọi connection helper A→B→owner Approve→helper ready. Không enumerate, sudo sandbox, SSH bypass trước approval.
4. Không đụng Gold production, DB live hay \`:5491\`.

**B — DEPLOY ARM GOLD UAT CANDIDATE**
1. Khi có host ARM quyền hợp lệ: snapshot **hiện tại** của \`light-remote-gold-uat\` + backup SQLite/service overrides (không đưa secrets lên cloud).
2. Tạo candidate path riêng từ checked Git \`20b584c\`, diff từ installed \`99b1d2f\`, copy 103 client core module như cần; preserve dependencies, ACL and systemd users.
3. Syntax/regression on UAT; override **4 UAT services only**, health check 4/4, test Wall login/auth/device registry/old signed rev6. If failed revert using snapshot/old overrides; **đừng upgrade Windows**.

**C — UPGRADE WINDOWS**
1. Backup currently installed per-user client, profile, enrollment/SQLite; không xóa local memory. Installer artifact path/hash §4, reverify SHA256.
2. Installer chính thức \`20b584c\` có thể khiến Agent mất kết nối tạm; dùng independent Scheduled Task + durable install-result receipt như prior UAT; không gọi running job = PASS.
3. Reconnect, verify **103/103 actually installed**, Agent Task Running, original Filesystem roots/PTY/Wall English intact, scoped signed rev6 unchanged, remove temporary install task.

**D — REAL MANUAL REPLICA-ORIGIN LIVE E2E**
1. Read current Account policy+CAS; store original mode/checkbox/Sync state. Global ON + ARM Home selected; chọn Windows Manual **via owner authorized Wall**, no direct PG edit.
2. Trong owner-bound **synthetic Windows repo** \`%LOCALAPPDATA%\Light Remote\Gold-UAT-99b1d2f\workspace\`, làm 1 Git commit hoặc native FS operation **bằng authenticated Light Remote Agent**; xác minh E2EE event outbox \`pending\`. Không trực tiếp gọi \`queueReplicaEvidence\`.
3. Chưa bấm Sync now: Home vẫn rev6, Windows pending, no event ACK — **must PASS negative**.
4. Owner bấm **Sync now** cho Windows, expect newly armed odd \`manualRequestSeq\`, local snapshot cap + signed proof, ARM Home atomic checkpoint **rev7**, Window event \`acked\`, Window ledger rev7 signed hash matches, Home ACK **7/7**. No second Home.
5. Sau khi snapshot lượt đầu, tạo 1 event mới, giữ pending đến lượt Sync now thứ hai; revision **8/8** only after second request, old replay duplicate idempotent.
6. Test OFF/deselect, Manual→Auto→Manual (only if owner approved for synthetic UAT), sequence fencing; do not overwrite concurrent owner edits.
7. Re-fetch current Account policy; restore **only test changes with latest CAS**, stop/report conflict rather than force overwrite.
8. Record exact event/checkpoint IDs, hashes, policy revisions/seqs, signed ACK, logs, snapshots, SHA, installer receipts.

**E — THEN CONTINUE:** full-device/network outage, IP changes, stale epoch/home rotation/conflict reconciliation, signed per-device UI status, PTY/task/Codex typed adapter, G4 P2P/relay under NAT, G5 fresh-session V2 restore, G6 macOS/Linux Desktop parity. Windows Codex binary \`codex_binary_missing\` remains separate.

## 9. BLOCKERS / RISKS / DO NOT DO

- **ARM host unauthorized**: production connector says \`agent_client_device_not_authorized\`; Gold UAT guest cannot sudo due \`NoNewPrivileges\`. Use official A/B. Không tái sử dụng session IDs cũ khi đã hết hạn, không tự nhảy sang Windows/host khác.
- **UAT vs production:** chỉ UAT \`:5591\`; host \`:5491\` là production. Cần snapshot trước cutover; **không di chuyển annotated restore tag**.
- **Manual E2E chưa PASS:** source candidate \`20b584c\` chưa triển khai. Keep live rev6/6 until safely upgraded.
- **Account CAS concurrency:** owner UI có thể thay revision; lịch sử rev14 không được dùng lại; đổi mode phải restore từ current signed policy, not stale snapshot.
- **ACK distinction:** event ACK \`acked\` không có nghĩa Replica already has Home-signed revision; cần kiểm đủ Home ledger, Replica hash/signature, Home ACK.
- **Privacy/authority:** không mix Light Remote, LightBI, Light Luna scopes; không ghi transcript/keys/plaintext cloud; don't infer project from ChatGPT text.
- **Avoid test explosion:** chỉ cần tests gating feature mới và vài parity smoke; không loop synthetic vô tận.
- **Codex binary blocker:** đã vá \`codex_home_permissions\` (Windows NTFS ACL) nhưng \`codex_binary_missing\` chưa fix; Long Memory không được phụ thuộc Codex.
- **Manual rowid cap:** append-only assumption, avoid deleting/compacting pending outbox; nếu thấy hiện tượng reuse thì STOP và redesign.
- **UI user simplicity:** checkbox + per-device mode + Sync now; IP/key JSON/NetBird/handshake tất cả là tầng infra, không đưa vào product UI.

## 10. ĐỊNH NGHĨA DONE CỦA SESSION KẾ TIẾP

Chỉ được chốt **G3 Manual Replica-origin E2E PASS** sau khi ARM UAT và Windows cùng chạy \`20b584c\`; proof source & manifest đúng; negative pending-before-click verified; owner-approved Sync now snapshot; ARM signs exactly rev7; event + checkpoint ACK verified; later event stays pending until next request; restart/off/mode changes fence stale grants; configs restored via fresh CAS; rollback receipts saved. Nếu thiếu quyền ARM hoặc cutover fail: **BLOCKED / PARTIAL**, không ghi PASS.

---

## APPENDIX A / B — HISTORICAL DOCUMENTS (ARCHIVE, NOT CURRENT STATUS)

To make this a self-contained handoff even if earlier chat context is unavailable, the file continues with the **verbatim** 2026-10-24 architectural Master Plan and the evolving 2026-10-25 Account/device-mode G3 testing handoff. They contain historic plans/results; **CURRENT TRUTH above overrides older claims**. Do not act on archived mutable policy revisions without re-verification.


---

### APPENDIX A — FULL ARCHIVE MASTER PLAN START

# LIGHT REMOTE GOLD — LONG MEMORY V2
## MASTER PLAN / BASELINE / GATES — 2026-10-24

**Status:** Approved architecture; implementation IN PROGRESS. This is a development plan, not a claim that V2 has shipped.
**Scope:** Extend ONLY the existing Gold branch `feature/gold-m6-integrated-20261023` in `n8n2erpnext/light-remote-mcp`. Single existing LXD `light-remote-gold-uat`, single integrated Gold Wall, no new Continuity app, required Project UI, cloud store, second LXD/Wall, or production change.
**Immutable restore:** annotated tag `gold-restore-before-memory-codex-20261024` peels to `ba579f8830a0654e8321204f17270db8d94c5593`, includes owner-tested Windows build #486. NEVER retarget tag.
**Gold state at plan creation:** cross-session Long Memory V1 PASS in real official MCP (82/82 tools) with `device_hmac_verified`; real handoff ID `3c643f8a-1484-4a5c-8043-5746a3782850`. Gold optional Long Memory/Codex independent flags; Codex app-server ChatGPT Plus observer is opt-in, Task Controller owner-gated. Existing V1 ledger `device-agent/gold-memory-ledger.mjs` has global `gold_checkpoints` table with no scope; bridge root is UAT-pinned. The scope-less table MUST NOT become automatic capture's canonical V2 store.

## WHY
Session A codes Light Remote on VPS-ARM and tests on DESKTOP-VA16D27 + macOS. Session B performs bug bounty on HOMESV. Session C researches 4G firmware on DESKTOP-VA16D27. Multiple ChatGPT Web sessions, 3+ Walls, shared Fleet devices and 1 account MUST NOT mix project memories; Windows can be Light Remote replica AND firmware Home. LightBI is another independent scope. Gold MCP sessionId is NOT a ChatGPT conversation ID; multiple Web chats may share one Gold remote session.

## NON-NEGOTIABLE CONTRACT
- **Scope-first:** immutable UUID `scope_id` / Memory Namespace per job, repo, workspace or subject; project creation NOT mandatory. Check `account_id + scope_id + membership/ACL + revision` before memory read/write. Never classify by title, guessed semantics or an AI suggestion alone. Explicit scope binding > inherited signed task/job work-context > unique owner-approved exact workspace mapping > Unassigned quarantine. Ambiguous → quarantine and ask owner ONCE.
- **Single authoritative writer per scope:** `home_device_id`, `home_epoch`, monotonic `revision`, canonical hash chain, explicit owner-approved migration. Executing devices may differ from Home and submit signed evidence; they DO NOT commit canonical checkpoints to competing local histories. Home offline → source durable Outbox, stale replica read, NO silent Home failover.
- **Local-first replicas:** each permitted device holds independent SQLite records, NEVER sync/copy a live SQLite DB file. Replicas may serve offline verified state with revision/stale status; missing peer is not a cloud backup. Scope membership and sync grants are separate from standard A/B device enrollment.
- **No server Memory payload:** Gold server handles account, routing, device authorization/epochs and transient encrypted forwarding only. No plaintext/ciphertext checkpoint/event payload persisted in PG, Redis, log or disk; bounded RAM buffers/backpressure/timeouts, E2EE by device/scope, prefer P2P/LAN/NetBird before relay. Future optional cloud encrypted replicas can be added without changing protocol.
- **Independent switches:** Long Memory OFF → no capture/sync or surprise DB creation. Capture `Auto | Follow Project | Manual`, Sync `Local only | Selected devices | All explicitly authorized devices`, Codex ON/OFF orthogonal. Manual checkpoints still require scope routing. Follow Project means owner-selected workspace/scope, NOT a mandatory Gold Project subsystem.
- **Truthful provenance:** checkpoint differentiates observed/claimed/test_passed/owner_approved/blocked. Codex suggestion is NOT task completion; owner approval/CAS required. MCP does not read private ChatGPT chat content absent an explicit tool invocation. Auto captures ONLY events Gold can observe.
- **Compatibility:** V1 checkpoints and original local HMAC must keep validating; never ship an unscoped V1 checkpoint as V2 canonical. No HMAC secret copying to replicas; V2 use per-device Ed25519 signatures, per-scope Home authority, SHA-256 hash/revision, AEAD encrypted sync and owner-approved key rotation/revoke.

## CAPTURE PIPELINE
Sources: completed Gold Plugin tool effects; Agent process/exec/PTY lifecycle with bounded result; scoped Git commit/build/test receipts; Task Controller transitions; Codex app-server completed turns IF module ON/owner requested; session close/hold with dirty work; safety timer flushes only pending changes. Strict typed events, no raw secrets/command args if unsafe. Ingest → authorize origin+scope+grant → redact/minimize → append durable local Event Journal → deterministic meaningful-event filter → 90s default coalesce keyed by `scope_id + work_context_id + task_id` → checkpoint summary/decisions/proven results/failures/blockers/next steps/evidence refs → Home commit → replicas. No checkpoint per tool, no writes for read-only unchanged operations. Per-scope quotas/retention, hashes/idempotency.

## LOCAL SCHEMA V2 (versioned migrations; SQLite FK/WAL; do not mutate V1 signatures)
- `lm_scopes(scope_id PK, account_id, home_device_id, home_epoch, capture_mode, sync_policy, key_epoch, status, created_at, updated_at)`.
- `lm_scope_members(scope_id, device_id, role, grant_id, grant_epoch, revoked_at)`.
- `lm_work_bindings(binding_id PK, scope_id, source_type, source_id, proof_type, accepted_at)`: verified workspace/repo/job/task lineage and unique binding.
- `lm_events(event_id PK, scope_id, work_context_id, origin_device_id, origin_seq, origin_signature, event_type, evidence_hash, payload, ingest_state)`.
- `lm_checkpoint_v2(checkpoint_id PK, scope_id, home_epoch, revision, prev_hash, content_hash, home_signature, structured_body, evidence_refs, committed_at)`; unique `(scope_id,home_epoch,revision)`.
- `lm_heads(scope_id PK, home_epoch, revision, head_hash, updated_at)`, `lm_scope_summaries(scope_id PK, head_revision, compact_handoff, digest)`.
- `lm_sync_outbox`, `lm_sync_inbox`, `lm_replica_ack`, `lm_sync_manifest`, `lm_quarantine`, `lm_legacy_map(old_checkpoint_id PK, scope_id NULL, assigned_by, assigned_at)`.
- Enforce scope FK and UNIQUE, transactional writes, indexed `scope_id/revision`, length bounds, no cross-scope joins in handoff. Keep V1 legacy/unassigned untouched and isolated; owner reclassification is auditable sidecar, never rewrite signed content.

## CROSS-SESSION RESTORE
After explicit ChatGPT Gold helper invocation and A/B, identify a trusted `work_context_id` or unique bound scope. If multiple eligible scopes, return concise choice; NEVER dump all checkpoints or guess from shared Gold sessionId. Read local Home or verified replica ONLY where authorized, with head revision, source device, evidence, synced revision and stale/fresh status. If Home offline, replica may show stale with explicit caveat. Extend current official memory MCP tools compatibly with `scopeId/workContextId`, add only minimal binding/sync-status functions; device-side per-OS path binding must not be fixed solely to UAT. Gold cannot auto-inject a ChatGPT Web turn or inspect hidden conversation.

## SYNC AND SECURITY PROTOCOL
Owner grants devices per-scope; same account enrollment alone is insufficient. Each sender signs bounded events; use device keys for provenance, per-scope AEAD key wrapped to authorized peers, key epochs and revoke. Direct P2P first; Gold Relay only forwards E2EE frames and ACK in bounded RAM; server may persist non-content control metadata (enrolled IDs, scope routing grant/epoch) but never Memory payload. Durable per-device outbox handles offline, retry/idempotency event UUIDs; receiver validates signature/grants/scope/epoch/hash then durably commits before ACK. Exchange manifests/head hash/revisions and transfer only delta; compare hash chains and quarantine divergence, NEVER LWW for task/decision. Home migration requires owner-confirmed epoch/fencing; offline ambiguous failover must fail closed to avoid split-brain. Revoke stops future sync but cannot erase plaintext already held on a lost device. Lost all keys/devices without backup means data may be unrecoverable.

## INTEGRATED GOLD WALL
Within ONE existing Gold Wall: Long Memory ON/OFF, capture mode, sync policy, scope list + bind work context, Home/Replica/grants, per-scope history, verification/provenance/revision/stale/behind/pending/conflict/key-missing, explicit owner reclassification/migrate/revoke. Keep a functional admin UI, no landing or second app.

## EXECUTION GATES — STRICT ORDER, MINIMAL END-TO-END ACCEPTANCE
**G0 Baseline/contract:** confirm exact Gold worktree/status, live route, restore peeled commit, V1 schema and transport. Save this plan in repo, version architecture contract. NO Gold production edits.
**G1 Scope isolation (first coding target):** additive scoped SQLite schema, scope creation/binding, Legacy/Unassigned, scoped list/get/handoff with indexes and fail-closed read/write ACL; v1 read/HMAC unchanged. Test Light Remote vs LightBI vs firmware separate; bad/missing binding cannot contaminate canonical handoff. Wall selector + MCP compat to follow when core proven.
**G2 Auto 1-device MVP:** typed source hooks, durable event journal, 90-second coalesce by verified scope, Auto/Follow/Manual control, no-change filter; read-only operations produce zero checkpoint; actual multi-operation task produces exactly one with evidence; Codex OFF OK. Owner sees checkpoint without invoking save.
**G3 Direct sync 2 devices:** device identity/keys, scope grants, signed event + E2EE, outbox/ACK/delta/replica; Windows test -> ARM canonical checkpoint -> Windows replica validates; offline reconnect no duplicate or wrong firmware scope.
**G4 No-store relay:** reuse existing Gold transport, bounded RAM ciphertext forwarding, metadata-only control plane, no retained payload even in logs; cross NAT offline/stale/rejoin reconciliation; explicit epoch fencing/migrate.
**G5 Scoped Web restore & controller:** new ChatGPT session with one verified scope gets exactly its memory and head/lag; task/Codex receipts correlate scope; 3+ devices same account don't contaminate data.
**G6 OS parity/release:** Windows/macOS/Linux Desktop/Server real devices, package path resolve, clear failures, rollback and docs. No synthetic test explosion or claiming Linux LXD implies cross-platform PASS.

**Acceptance scenarios:** (1) 3 scopes/no cross-writes; (2) 20 tool events -> 1 auto checkpoint; (3) ARM+Windows roundtrip canonical E2EE/ACK/restart; (4) Home offline/stale/queue/reconnect; (5) relay no-store audit; (6) independent ChatGPT Web restore using official MCP/no shell; (7) ARM/Windows/macOS/HOMESV and Codex optional/owner-gated task; (8) rollback + v1 HMAC + Gold #486 parity.

**Out of scope:** scraping entire ChatGPT Web transcripts, mandatory Projects, automatic completion of Codex tasks, CRDT merge of owner decisions, cloud payload backup, uncontrolled async browser turns, multiple canonical Homes for same scope, semantic all-account memory search before namespace isolation.

## HANDOFF / PROGRESS
- Restore tag immutable and live Gold UAT unchanged until explicit staged promotion.
- Do not checkpoint THIS plan into global unscoped V1 memory. Save under `docs/gold` and include in Git; when G1 is accepted, write it into the Light Remote Gold scope.
- Update this section after each tested gate with precise file paths, SHA, evidence, unfinished work. Never mark code-only features as deployed.

## IMPLEMENTATION LOG — 2026-10-24, FIRST CODING PASS (G1 partial)
- Confirmed worktree `feature/gold-m6-integrated-20261023`, repo previously clean at `c8377fe9b81fdd9ffe7617a2e2d850966dc1776e`. Annotated restore tag peels to `ba579f8830a0654e8321204f17270db8d94c5593`, unchanged.
- Added `device-agent/gold-memory-scope.mjs`: isolated SQLite tables `lm_scopes, lm_work_bindings, lm_checkpoint_v2, lm_heads, lm_legacy_map, lm_quarantine`; identity-bound create/list/bind/resolve/append/read/handoff, fail-closed Home writer, Ed25519 signed revision/hash chain, no V1 edits, legacy checkpoint unassigned, account/scope SQL filtering.
- Integrated G1 methods into optional `createGoldWallModules({scopeIdentity:{accountId,deviceId}})`; runtime without trusted identity cannot use new scoped API. Long Memory OFF remains inert. New APIs intentionally NOT YET exposed on Wall or MCP.
- Added `deploy/scripts/selftest-gold-memory-scope-v2.mjs`: 3 namespaces, no cross scope reads, owner binding conflict rejection, tamper detection, revision and signature verify on restart, V1 HMAC remains valid.
- Existing `selftest-gold-cross-session.mjs` and `selftest-gold-wall-modules.mjs` still PASS.
- **Remaining G1:** owner-selected scope binding/UI, actual Gold agent trusted identity injection, MCP scoped backward-compatible API, rollout migration on isolated LXD candidate and live UAT acceptance. No Auto/event journal/sync/relay/Cloud implemented yet.
- **Runtime deployment:** NOT PERFORMED. Existing Gold UAT and released clients untouched; code is in worktree only. Record Git SHA in later handoff once committed.

## G1 FOLLOW-UP — Scoped Owner Wall, MCP, and package (2026-10-24)
- Added trusted runtime scope identity callback from device enrollment in `device-agent/operator-agent.mjs`; `device-agent/gold-memory-cli.mjs` reads enrolled account/device from local Agent state file, not caller-controlled MCP request. Without identity, scoped methods fail closed.
- Existing Gold Wall now has a scoped Memory area (create scope, explicit workspace/repo/work-context bind, scoped checkpoint, scoped handoff, legacy V1 clearly unassigned) and owner/CSRF-gated endpoints `/api/gold/modules/scopes`, `/scope`, `/scope/bind`, `/scope/checkpoint`, `/scope/handoff`. Capture mode may be selected as V2 metadata, but Auto and Follow Project trigger engine are **NOT implemented yet**, and sync policy stays local_only in UI.
- Added scoped actions to the existing Agent CLI, Gold Plugin bridge and the same 2 official Long Memory MCP tools (optional `scopeId`, actions `scopes`, `scope_resolve`, `scope_handoff`, `scope_get` and `scope_save`; no third app/tool needed). Legacy `get/list/handoff/save` remain functional for V1.
- Added `device-agent/gold-memory-scope.mjs` to frozen-safe additive Client core manifest (now 96 files), preserving 90-file #486 baseline and Material Icon assets.
- Real tests: `selftest-gold-memory-scope-v2.mjs` 3 scopes, cross-scope denial, tamper, Home-only writer, legacy isolation; `selftest-gold-cross-session.mjs` Wall owner/CSRF, scope create/bind/scoped handoff and V1; `selftest-gold-memory-cli-scoped.mjs` real device-local CLI subprocess write/read/restore using enrolment JSON; `selftest-gold-memory-plugin.mjs` approved session, bounded shell-inert encoding and no fallback; `selftest-gold-wall-modules.mjs` existing regression.
- Staged Client core package independently on ARM using `stage-client-core.mjs` and `--verify`: 96/96 checksum PASS. Frozen #486 90-file parity `extension` PASS, 39 Material assets and 18 required icons PASS; packaged Wall /,/approve,/permissions,/settings all HTTP 200.
- Known G1 remaining: accept/review on REAL Gold UAT LXD (not production); update plugin approved client root binding to UAT candidate; check actual official MCP `scopes`/`scope_handoff` after ChatGPT tool-catalog refresh, fresh cross-chat continuity and no accidental data mixing. G2 Auto, device replication, relay, membership ACL are NOT done.

## G1 UAT ACCEPTANCE — DEPLOYED, 2026-10-24
- Source code commit **`38c712ab7604423fb3632d5333aa5f489ef6e890`**, branch `feature/gold-m6-integrated-20261023`, pushed to origin.
- Existing LXD `light-remote-gold-uat` candidate staged at `/opt/light-remote-gold-uat-candidates/38c712ab7604423fb3632d5333aa5f489ef6e890` via existing `gold-g3-stage-candidate.sh`; package-lock matched.
- Four existing service ExecStart overrides target the same SHA; process supervisor, Operator, Plugin, Wall all `active`. Existing unit files preserved; plugin memory client root env binding follows candidate; pinned UAT enrolled device unchanged. Gold Wall is internal `10.192.135.61:5491` (fronted externally by existing NetBird `:5591`) and `/login` HTTP 200.
- Created Btrfs LXD snapshot `light-remote-gold-uat/gold-before-g1-scoped-20261024` BEFORE switching services. Rollback also available via removing `zzzzzzzzzz-g1-scoped-20261024.conf` drop-ins and restarting original candidate SHA `17030d90d142aa82d9985af955d487d93ce1ac40`. Immutable annotated restore tag remains `ba579f8`; do not move it.
- Actual Gold MCP `tools/list` HTTP 200, 82 tools. Scoped schemas now published server-side: read `scopes|scope_resolve|scope_handoff|scope_get` and write `scopeId/status/evidence`. Current ChatGPT conversations may still have cached input schemas and require a Development tool refresh to invoke NEW actions through dedicated names.
- Same A/B-authorized Gold UAT Plugin `light_remote_long_memory_read(action=handoff)` PASS after restart: 3 previous V1 checkpoint IDs unchanged and all `device_hmac_verified`.
- Under the actual Gold UAT Agent owner identity, scoped CLI `action=scopes` returned `ok:true` and empty scope list; additive V2 schema initialized, no synthetic V2 checkpoint permanently written. Existing legacy records remain **3 unassigned**, not mixed into any scope.
- Live owner Module flags remain `longMemory:true, codexBridge:true` revision 2, Codex `authMode:chatgpt,plan:plus,connected:true`, one `todo` Task; no Codex inference quota spent.
- LXD candidate tests PASS: three-scope separation, SQLite V1 HMAC, Ed25519 and hash tamper, fail-closed Home writer, scoped Agent subprocess, Wall owner/CSRF, MCP bridge auth, Gold Wall regression. ARM staged 96-file Client package and frozen #486 90-file parity PASS.
- **G1 code + runtime UAT acceptance: PASS.** Not yet verified new scoped actions from a newly refreshed ChatGPT Developer tool schema, and Windows/macOS/Linux Desktop parity belongs to G6. No Auto trigger, cross-device sync or relay is claimed operational.
- **NEXT = G2:** implement typed local event journal, per-scope canonical binding, Auto/Follow Project/Manual trigger policy, coalescing/idempotency, automatic checkpoint after meaningful Gold actions; retain fail-closed Unassigned behavior and Codex independence. One bounded real UAT E2E required before G2 PASS.

## G2 AUTO CAPTURE ENGINE — 2026-10-24 CODE PASS; LIVE UAT PENDING
- Added `device-agent/gold-memory-auto.mjs` with durable SQLite `lm_events` and `lm_event_batches`: deduplicated per `scope_id,event_type,event_ref`, only trusted typed event categories (filesystem_changed, repository_head_changed, task_created, task_state_changed, process_completed); no raw scripts/command output/transcript/secrets; status=observed, never inferred "done".
- Owner-approved workspace/repository binding is resolved by realpath + correct directory boundary, longest binding wins; non-rooted/unmatched paths fail closed. Task binding is explicit; account and Home ID from device-local enrollment, not MCP payload.
- True Gold Agent source triggers: successful structured native FS write/edit/mkdir/delete under owner-bound workspace; successful exec where verified Git HEAD actually changes from previous SHA; scoped Task Controller create/transition and owner-confirmed Codex receipt transition. Read-only exec/filesystem/search/output and unchanged Git HEAD produce no auto event. No attempt to inspect hidden ChatGPT messages; Codex OFF works with filesystem/git events.
- Auto / Follow Project / Manual policies are selectable on the existing Gold Wall for each scope. Manual never auto-captures. Follow Project requires owner-bound workspace/repository sources; task-only events not accepted in Follow Project. Auto accepts scoped typed events. Gold module OFF cannot capture/flush.
- Durable coalescer flushes pending groups by `scope_id + work_context` after default 90 seconds or a bounded full batch of 25; one canonical Home-signed Ed25519 checkpoint and marking source events committed happen within ONE SQLite transaction. Agent daemon checks every 5 seconds. No constant spinning or checkpoint per read-only tool invocation. Journal queue bounded to 5k pending events per scope; fail closed on overcapacity.
- Dynamic G2 status API `GET /api/gold/modules/auto/pending` is owner authenticated; `POST /api/gold/modules/scope/capture` requires owner + CSRF. Existing Gold Wall scope selector supports apply mode. New optional scoped Task Controller event link uses only explicit selected scope, task still needs owner confirmation to transition.
- New test `deploy/scripts/selftest-gold-memory-auto-v2.mjs`: 20 distinct same-scope events → one signed checkpoint, persisted queue after process restart, duplicate replay zero extra commits, separate LightBI/Firmware scopes, unassigned and replica fail closed, mode OFF, real pathname and task transitions. Existing V1 HMAC, G1 scope, owner-CSRF, plugin session and Codex receipt regressions PASS.
- Candidate packaged on VPS-ARM: 97 files, checksums verified, frozen #486 baseline 90-file parity PASS, Material assets and 4 Wall routes PASS. **NO cross-device sync or Gold Relay implemented; no claim of automatic capture of conversation-only decisions**.
- **Pending G2 release gate:** create a Git candidate in existing LXD `light-remote-gold-uat`, snapshot G1 before cutover, run one real Agent/Gold Plugin triggered mutation and wait for an autonomously produced scoped, signed handoff (without explicit checkpoint command), verify retained after service restart and V1 compatibility; revert on any issue.

## G2 REAL GOLD UAT ROLLOUT — TRIGGER RECEIVED, AUTOMATIC FLUSH VERIFICATION UNDERWAY
- Gold G2 source SHA `5d5c165127be028198868f4500f33c67163bbc53` deployed in existing `light-remote-gold-uat` LXD as one immutable candidate, no other service/new Wall. Pre-cutover snapshot `gold-before-g2-auto-20261024` preserved; G1 source `38c712ab...` remains on disk and systemd drop-ins are removable.
- Four existing services `light-remote-gold-process-supervisor`, `light-remote-gold-operator`, `light-remote-gold-plugin`, `light-remote-gold-wall` restarted on G2 candidate and all active; same A/B-approved Gold device; V1 handoff `3c643f8a-1484-4a5c-8043-5746a3782850` still `device_hmac_verified` using official MCP read tool.
- On the real UAT `gold-uat` device account, created one isolated UAT Git workspace `/var/lib/light-remote-gold-uat/wall/g2-auto-uat-workspace` and one explicitly owner-approved `auto` capture scope `7a0426e2-ef34-45de-a0be-31adefc0ef48`, Home=actual UAT device `dev_e68276c691ba5413f42d5dde`, bound to exact workspace path. This is intentionally separate from any Light Remote/LightBI/HOMESV/Firmware production scopes.
- Real Gold Plugin/Agent `light_remote_exec` successfully created a new Git commit HEAD `274adbd8a074354d968345848843960b28677a85` (previous HEAD `69c269b08acd3070370f0be91273c6721dcbe651`). Device-local scope journal immediately showed **1 pending event** with scope ID correct, revision 0; no explicit checkpoint save or synthetic journal insert was used.
- **Still to prove in this turn:** after 90-second coalescing interval, Agent's own 5-second timer creates exactly one Home-signed V2 checkpoint, marks event committed, preserves V1, and survives restarting relevant Gold service. Do not mark full G2 PASS before observing that.

## G2 REAL AUTONOMOUS UAT ACCEPTANCE — PASS, 2026-10-24
- Original G2 running source `5d5c165127be028198868f4500f33c67163bbc53` received one *actual* authorized Gold Agent Git HEAD change. One event entered the bound UAT Auto scope `7a0426e2-ef34-45de-a0be-31adefc0ef48` without invoking manual Memory APIs.
- After natural 90-second coalescing + 5-second daemon timer, **automatic** scoped checkpoint `5ed8292a-dc53-4329-b7ec-f1ac677a5a20` appeared at revision 1; `integrity:home_ed25519_verified`, body preserves new Git HEAD `274adbd8a074354d968345848843960b28677a85`, pending queue 0, and all 3 legacy V1 records remained Unassigned.
- Gold Wall service was restarted; the **same** checkpoint and revision survived and verified, pending 0; official Gold MCP `light_remote_long_memory_read` continued to read original V1 handoff `3c643f8a-1484-4a5c-8043-5746a3782850` with `device_hmac_verified`. Wall /login HTTP 200, both modules ON, Codex ChatGPT Plus still connected, original Task Controller task still `todo`.
- One authorized read-only Git status/HEAD command against the same bound workspace caused zero additional queued events or checkpoint revision changes. No codex inference, no cloud storage, no cross-device transfer.
- Security improvement following UAT: `appendGoldScopedCheckpoint` now accepts `transactionManaged` ONLY via privileged fourth internal parameter; caller input object can no longer bypass transaction handling. `flushGoldAuto` explicitly passes internal option. Regression includes caller attempting `transactionManaged:true`.
- **G2 Auto MVP:** PASS for typed/durable local event journal, scope-bound Git HEAD trigger, automatic timer flush, restart persistence, idempotency, and legacy isolation on actual Linux ARM UAT. Structured FS/task triggers pass code-level tests but still require physical platform-specific UAT under G6; auto-capturing chat-only decisions is NOT supported. No claims of G3 P2P/relay sync.
- G2 post-UAT security-fix candidate must be deployed to the **same existing** Gold UAT, not production; keep prior G2 accepted proof and both snapshot / Git restore gates.

## G2 FINAL CUTOVER / HANDOFF — 2026-10-24
- **Current UAT runtime source SHA:** `5ab5e9eda06eaa5efc75105392f1e539bc5acb73` (G2 originally demonstrated on `5d5c1651...`; final contains additional transaction privilege boundary fix). Four active existing services use the same candidate; no new Wall/LXD/Cloud store. Snapshot `gold-before-g2-auto-20261024` and original immutable Git restore tag `ba579f8830a0654e8321204f17270db8d94c5593` remain intact. G1 candidate `38c712ab...` and previous G2 candidate `5d5c1651...` remain available for rollback.
- After **final** source cutover/restart: official Gold MCP helper `ready` on exact device; read of original V1 handoff `3c643f8a-1484-4a5c-8043-5746a3782850` returned `device_hmac_verified`. Existing Auto UAT scope `7a0426e2-ef34-45de-a0be-31adefc0ef48` restored revision 1 and checkpoint `5ed8292a-dc53-4329-b7ec-f1ac677a5a20` with `home_ed25519_verified`; zero pending events, three legacy V1 records remain Unassigned.
- Wall `http://10.192.135.61:5491/login` HTTP 200; module flags Long Memory ON, Codex Bridge ON, revision 2; Codex ChatGPT Plus connected, old Task Controller task `todo`. No paid inference triggered.
- A real Git HEAD transition in the UAT-bound workspace autonomously produced exactly one signed checkpoint through the existing Gold Agent's 90s coalescing timer without manual save/flush. A read-only Git command did not generate more journal events. PASS scoped Linux ARM local-first automatic checkpoint MVP.
- **G2 complete within bounded scope**: Auto/Follow Project/Manual controls, scoped event journal, verified filesystem and Git HEAD triggers, Task Controller transitions, dedup, coalescing, signed local checkpoint, restart persistence. NOT full conversation transcript capture; effects occurring solely in chat text or uninstrumented shell actions are not knowable to MCP. Cross-device sync is NOT implemented.
- **NEXT G3 (do not claim completed):** design per-device signing/encryption and per-scope explicit sync grants; durable outbox+ack and delta reconciliation between Gold Agents, without SQLite file copy or Gold server payload storage; begin with two owner-approved devices (ARM Home and Windows replica), keeping Home authoritative and wrong-scope events quarantined. Transport must reuse existing Gold channel where feasible; first inspect code/protocol. Minimal tests; no second app.

## G3 DEVELOPMENT — LOCAL-FIRST PEER PROTOCOL / FIRST PASS (2026-10-24)
- Code added in `device-agent/gold-memory-sync.mjs`. It implements a purely device-local sync protocol; NOT a Gold server relay/transport yet. `client/core-files.json` now includes 98 Client core files (90-file owner-approved frozen #486 parity preserved).
- Separate local device keys: existing 0600 Ed25519 file for signatures, new 0600 X25519 private file for E2EE, public identity fingerprint for owner confirmation. Home checkpoint **retains its original Home Ed25519 signature** and revision/prevHash chain; Replica validates it, never re-signs checkpoint as a new canonical writer.
- Owner-confirmed scope grants pin an exact recipient public signing+encryption key fingerprint, recipient scope invitation is Home-signed, and Replica acceptance requires pinning Home key fingerprint and its own matching local identity. Own/account Home/Replica roles and revocation stored only in per-device SQLite. Grant/regrant resets stale Home-side ACK and encrypted outbox to avoid split-brain key rollover; recipient local key pinning forbids silent rotation.
- E2EE frames: sender ephemeral X25519 Diffie-Hellman + HKDF-SHA256 + AES-256-GCM, AAD binds account, scope, grant, Home epoch, revision, source/destination IDs and checkpoint; outer frame signed Ed25519 by Home. Each frame <=48KB. Ciphertext and signed metadata only in durable device-local `lm_sync_outbox`, not in the Operator Postgres/Redis/server log.
- Replica apply: strict account / recipient / grant ID / key checks, ciphertext signature and authentication, immutable signed checkpoint content hash, contiguous revision + prevHash check, transactional SQLite insert/head update/inbox; duplicates ACK idempotently; wrong scope/gap/divergence fail closed.
- Signed ACK from Replica is checked with recipient's owner-pinned public key, exact checkpoint/revision/hash/grant and monotonic sequence before Home moves its `lm_replica_ack` cursor. Owner revoke stops any future Home delivery and clears pending encrypted frames; previously received decrypted local data cannot be reliably erased remotely.
- Integrated optional methods into existing `createGoldWallModules` only. Existing owner+CSRF Gold Wall routes provide local device public identity, scoped sync status, policy and owner-confirmed grant/accept/revoke. Existing Gold Wall UI now shows local-only/selected/explicitly-authorized policy and per-scope sync metadata. UI explicitly says **network peer transport NOT active**.
- End-to-end development test `deploy/scripts/selftest-gold-memory-sync-v3.mjs` runs **two separate local SQLite databases on ARM**, validates Home→encrypted frame→Replica→signed ACK→Home, 2 contiguous checkpoints, restarts, duplicate ACK/frame, ciphertext tamper, wrong account/scope, conflicting Home writer, local 0600 key modes, owner confirmation and revoke→regrant→full revision reconciliation. Other G2 Auto, V1 HMAC, owner Wall/CSRF regressions PASS.
- **IMPORTANT, not complete G3:** no real two-device P2P network transport, no automatic sync scheduler, no actual Windows/macOS client UAT, no cryptographically attested matching-account enrollment directory for a second peer, no Cloud payload storage (future optional), no server relay G4. Out-of-band fingerprint confirmation in this stage is owner-selected local trust, not proof that Operator has verified the other device belongs to this Light Remote account. Do NOT claim same-account auto sharing is operational. Do NOT enable arbitrary network peer ingress before A/B or device-scoped sync authorization policy is proven.
- **NEXT:** stage current code on existing Gold UAT after snapshot of G2; verify G3 module methods there without issuing any real peer grants or sending payload. Then implement direct authenticated P2P transport using existing approved Gold device identities and per-scope grants, with a REAL ARM↔Windows test and owner consent; finally wire bounded E2EE relay (G4) that never stores Memory data on Gold server.

## G3 UAT FIRST CUTOVER / VERIFIED STATE — 2026-10-24
- **Runtime SHA** `4407cc21703671b0a1f110b83e45330e0b36520b`, same Gold branch and same existing `light-remote-gold-uat` LXD. Snapshot `gold-before-g3-sync-20261024` taken BEFORE service change, preserved. All four Gold systemd service commands point to this candidate and are active. Gold Wall `http://10.192.135.61:5491/login` returned HTTP 200.
- Gold Plugin environment still pins `LIGHT_REMOTE_GOLD_MEMORY_DEVICE_ID=dev_e68276c691ba5413f42d5dde`, same as `device.json` enrollment inside UAT. Source root env matches G3 SHA. No unauthorized rebinding or device switch performed.
- Read-only local device check on exactly `light-remote-gold-uat`: existing V1 handoff `3c643f8a-1484-4a5c-8043-5746a3782850` returned `device_hmac_verified`. G2 Auto checkpoint in scope `7a0426e2-ef34-45de-a0be-31adefc0ef48` remains at revision 1 and `home_ed25519_verified`; 3 legacy V1 records unassigned. G3 local device public identity/fingerprint initialized with 0600 private X25519 key. Sync policy remains **local_only**, **0 granted peers**, no Memory payload transmitted. Long Memory/Codex flags ON/ON; Codex ChatGPT Plus connected and old Task `todo`.
- G3 candidate test on LXD PASS: two DISTINCT temporary local SQLite databases represent Home and Replica, exchange E2EE frame + signed ACK, verify contiguous revisions, restart/duplicate/tamper/wrong scope and revoke/regrant reconciliation. Owner/CSRF and old Gold regressions PASS.
- **Official Gold plugin A/B note:** current ChatGPT `@light-remote-gold` helper at this moment reported a DIFFERENT active device ID `dev_8d0715fce77efffce4c5ed28`. The official `light_remote_long_memory_read` correctly refused this non-UAT session with `gold_memory_device_binding_mismatch`. This is a SESSION TARGET mismatch, not evidence the UAT persisted ledger or plugin's UAT pin changed. Do NOT switch the pinned device to accommodate this wrong session; next owner A/B must originate from exact Gold UAT Wall before doing official MCP cross-device acceptance. No Rescan of tool catalog required for that target correction.
- **Milestone classification:** G3 **protocol/code + same-LXD test + candidate deployment: PASS**. G3 **REAL ARM↔Windows authorized P2P network transfer: NOT DONE**. G3 cannot be considered fully accepted until Operator-enrolled same-account peer identity is verified, per-scope owner grant is established on both devices, direct transport carries only ciphertext without server persistence, and two actual different device replicas reconcile. G4 ciphertext-only relay remains future work.
- **Next implementation:** extend trusted Gold Account/Operator mapping for a same-account peer grant (no caller-supplied accountId as sole proof); add constrained P2P transport with signed peer calls over existing Gold device stack and idempotent ACK; run one real two-device test, then update Wall sync to show `in_sync / behind / offline` from actual peer state. No second LXD, Wall, Continuity app or compulsory Project.

## WINDOWS GOLD G3 UAT BUILD — REAL WINDOWS RUNNER PASS (2026-10-24)
- Existing Windows GitHub Actions workflow `windows-native-client.yml` already produced build for G3 UAT source `4407cc21703671b0a1f110b83e45330e0b36520b` (run `40096776179`, successful). BUT a new platform-specific crypto/SQLite ACL smoke was added before directing owner to install on Windows.
- Fix source `f5406fbe94c2e7efe237c4247cd748fb63c66287`: new `gold-memory-key-permissions.mjs` enforces user-SID-only ACL through Windows `icacls`, while retaining POSIX 0600 checks; V1 HMAC, V2 Ed25519 and G3 X25519 use common fail-closed private key policy. Added to canonical package manifest and Windows workflow tests. First Windows job `40098529678` found `gold_modules_database_permissions` because SQLite mode was incorrectly interpreted using NTFS POSIX bits — valuable actual Windows regression.
- Follow-up fix `1fec757a42fdf6db06ac7aebca48791796fb458e`: Gold Wall SQLite database also uses Windows owner ACL instead of POSIX mode comparison, while retaining POSIX behavior. **Windows build run `40098670159` PASSED completely**: Windows native G3 crypto Home→Replica, V1/V2 scope/HMAC, 99-file package (baseline #486 remains frozen), tray/self-test, full and compact installers, updater rollback, install and uninstall.
- Verified workflow artifact `12562126226` from exact source SHA; artifact name `light-remote-windows-x64-1fec757a42fdf6db06ac7aebca48791796fb458e`, archived ZIP SHA256 `2e6c9133296207578676f2175dc0c938a1789918a651555c06bf1abb20a6059f`, expiration `2026-11-07T13:40:05Z`. Download via `https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40098670159/artifacts/12562126226` (GitHub sign-in may be required).
- Archive includes `Light-Remote-MCP-Setup-x64.exe` (175265787 bytes; SHA256 `ec0e70cc9ba97569571ddffa2f1b2c7e7cdaebee3927945e2f3bf9b0ecd481c6`), `Light-Remote-MCP-Compact-Setup-x64.exe` (154324692 bytes; SHA256 `a742691575ab5a082583646b85be4062651af50bbd3cdf389baa39cb26d7d010`), and `SHA256SUMS.txt`. Version embedded in repo `0.9.0-rc.49`; source SHA is the reliable Gold/UAT distinction.
- **Installer collision caveat:** Inno Setup uses existing production per-user AppId `A8D073F5-9792-4FA6-96A6-13C565F255F3`, HKCU startup and `LightRemoteDeviceAgent`/Updater scheduled task, so running setup on `DESKTOP-VA16D27` **UPDATES/REPLACES existing Windows Light Remote** rather than installing a side-by-side isolated Gold client. No install was performed by ChatGPT this turn. Owner must knowingly choose update or separate physical UAT path/installer packaging in future.
- **G3 milestone still open:** Real ARM `light-remote-gold-uat` to actual `DESKTOP-VA16D27` P2P transport, authenticated same-account peer grant, and persistent E2EE delta sync are not wired. The built Windows client contains G3 local protocol and Wall modules but doesn't magically synchronize before a direct transport exists. Production not changed, LXD UAT still runs prior compatible protocol SHA `4407cc2...`.

## G3 REAL ARM + WINDOWS CLIENT ACCEPTANCE — TWO HOSTS, ENCRYPTED TEST COURIER (2026-10-24)
- Owner installed the verified Gold Windows UAT setup built from `1fec757a42fdf6db06ac7aebca48791796fb458e` on **DESKTOP-VA16D27**. Official `@light-remote-gold` connection helper `ready`, inspected device `dev_8d0715fce77efffce4c5ed28`, Win32/x64 `online`. Actual per-user installation version `0.9.0-rc.49`, Scheduled Task `LightRemoteDeviceAgent` Running, five core Memory modules present including `gold-memory-key-permissions.mjs`. Gold Wall actual flags Long Memory ON, Codex Bridge ON (revision 1).
- Compared SHA256 fingerprints of the **trusted local enrollment account IDs**, not user-requested strings: Windows and actual LXD `light-remote-gold-uat` device `dev_e68276c691ba5413f42d5dde` MATCH. Windows NetBird service Running and Windows→ARM Gold Wall at `100.94.184.141:5591` TCP reachable. This is a transport *network-readiness* check, not a P2P sync implementation.
- **Isolated synthetic UAT only**: test Home SQLite at ARM LXD `/var/lib/light-remote-gold-uat/wall/g3-wire-uat/home.sqlite`; test Replica SQLite in Windows local temp `light-remote-g3-peer-uat-20261024/replica.sqlite`. Real Gold Wall SQLite on both devices remains untouched by these test scopes. One test scope `d4c4402e-dcaa-40c8-b505-d37016ab72d2`, one synthetic checkpoint `ddd4c1be-e18b-44c4-b003-93bce14485f3`. NO Light Remote source/project history, LightBI records, private transcripts or credentials were transferred.
- Home UAT issued an invitation signed by its Ed25519 device key, pinned to Windows's ephemeral test key fingerprint. Windows verified Home fingerprint/invitation and accepted the synthetic Replica grant, revision 0. Then **on actual different ARM and Windows hosts**: Home generated X25519/AES-GCM E2EE revision-1 frame, Windows verified outer Home signature, decrypted, validated original Home checkpoint Ed25519 and prevHash and committed revision 1; Windows generated signed ACK; Home verified ACK and advanced per-peer `ackRevision=1`, `behind=0`. Checkpoint ID remains identical on both hosts, `home_ed25519_verified`.
- In a fresh separate Windows Node process the replica reopened local SQLite: revision 1, `home_ed25519_verified`, same checkpoint ID. Real Windows Gold Wall still ON/ON and had **0 real project scopes**. Test UAT keys are separate from actual per-user Memory keys.
- **Critical limitation / classification**: the encrypted *synthetic* invitation/frame/ACK were transported between remote tool calls through the ChatGPT test harness as a **temporary courier**. This proves G3 crypto + storage + account match on two physical devices, but is **NOT autonomous P2P transport**; no claim of background delta or serverless production sync. Do NOT use this harness as the product transport or pass real Memory through ChatGPT tool outputs. No Gold Operator server persistence was added. Owner approval for real project scope peer grants still requires the actual Gold Wall owner UI and authenticated device membership.
- **Next gate to implement**: peer-to-peer transport from Windows/ARM Gold Agents via approved NetBird route, authenticated peer handshake and exact-scope grants, bounded encrypted frame+ACK exchange, offline durable retries and resume after reconnect, with zero Gold control-plane payload storage. Then rebuild/reinstall Windows UAT for the new transport; avoid production change and no independent Continuity app.

## WINDOWS INSTALLED-SOURCE INTEGRITY CHECK — 2026-10-24
- Read actual installed Windows client modules under `%LOCALAPPDATA%/Programs/Light Remote MCP/agent/device-agent`; compared SHA256 against ARM Gold source at `1fec757a42fdf6db06ac7aebca48791796fb458e`.
- Windows checkout/build normalizes source into CRLF (`gold-memory-sync.mjs`: 450 CRLF sequences), so raw byte hashes differ from Linux. After converting CRLF→LF, Windows installed file hashes match **exactly** the ARM repository: `gold-memory-sync.mjs` = `01200dd5bfa01f3be5a3aa7ad9002a45ed108c7e679c7990917c9b1752dd01c8`; `gold-memory-key-permissions.mjs` = `ae93685f3782d880e2e6fc450f72e9d2c0bacd375766da451f3b472d40f9ccc1`; `gold-wall-modules.mjs` = `641a2f98032e5fd16117b237895719926ee09064ea3c9f90dd425f9a8702c048`.
- Three-module byte-normalized match establishes installed Windows G3 implementation and Windows key ACL module match repository content; it is not independent supply-chain attestation of the entire installer.

## G3 DIRECT NETBIRD P2P DEVELOPMENT — 2026-10-24 (RELEASE PENDING)
- Additive `device-agent/gold-memory-peer.mjs`: narrow `POST /api/gold/peer/v1` endpoint embedded into **existing device-local Gold Wall** (not a separate service), intercepted before Web cookie login; requires device Ed25519 signature, matching owner account, active per-scope Replica grant, strict `Home/Replica` device IDs, 120-second timestamp and a unique random nonce persisted against replay in local SQLite. Only actions `pull` (returns E2EE frame) or `ack` (verifies existing Replica-signed ACK). Does not accept arbitrary checkpoint uploads or plaintext notes.
- Poll model: Replica connects outbound to owner-chosen RFC6598 NetBird IP 100.64/10 over HTTP (VPN encryption + application signature/E2EE). Forbid DNS, public HTTP, loopback, URL path/credentials/query. No incoming Windows listener or Gold cloud server storage. Client sends signed request; Home validates and sends one bounded signed/AEAD encrypted frame; Replica validates Home signature/contiguous hash chain/owner-pinned keys and writes local SQLite; signed ACK returns to Home and advances its cursor.
- Opt-in durable `lm_peer_routes` per Replica Scope with owner/CSRF config via existing Wall, background polling every 45s (max two peers/tick) only when enabled, with last success/error and safe cancellation during Agent stop. OFF/default creates no route or network traffic. Wall shows local policy and owner-entered NetBird URL. G2 Auto remains independent.
- `deploy/scripts/selftest-gold-memory-peer-v3.mjs` simulates Home HTTP receiver with two distinct SQLite databases and tests authenticated request, signed ciphertext/ACK, replay denial, stale timestamp, wrong account, invalid home URL, scope registration and idempotence. Existing G1/G2/G3 regressions and 100-file package/core parity PASS. Windows CI now explicitly runs P2P test before packaging.
- **Do not declare G3 fully accepted until** Gold LXD UAT receives a real signed pull from Windows over NetBird path without copying frame through ChatGPT, validates signed ACK, preserves V1/G2; then rebuild/reinstall Windows, enable per-scope polling via owner and prove at least two successive revisions automatically transfer after restart. Scope used for tests MUST be synthetic and separate from project memory. Do not auto share user project scope.

## G3 DIRECT NETBIRD PEER — CURRENT UAT CUTOVER / WINDOWS BUILD (2026-10-24)
- **ARM/LXD runtime SHA** `ed8fa123ae3e895fcdd11e0c54cf22ad38b6fec8` (original implementation `402dc6955e7a6e2ead852c70d89359b308cd93d5`; ed8 only adjusts a test fixture file mode on Linux). Existing `light-remote-gold-uat` LXD only; pre-change snapshot `gold-before-g3-netbird-peer-20261024` preserved. All four Gold units ACTIVE, no production release and no additional Wall service.
- Signed narrow `POST /api/gold/peer/v1` route is deployed on existing Gold Wall. **ACTUAL Windows→ARM NetBird HTTP probe** to `http://100.94.184.141:5591/api/gold/peer/v1` reached the endpoint and correctly returned `403 gold_peer_request_invalid` for an unsigned request. Therefore network path and denial gate PASS; this alone does not establish full signed transfer.
- Existing Windows installation remains older approved Windows Gold build `1fec757a42fdf6db06ac7aebca48791796fb458e`. The new Windows GitHub Actions run `40101661100` built source `402dc6955e7a6e2ead852c70d89359b308cd93d5` and finished **SUCCESS**, including new `GOLD_G3_P2P_SIGNED_NONCE_REPLAY_NETBIRD_ROUTE_CRYPTO_ACK_PASS` on an actual Windows CI runner, all existing G3/V1/V2/Native Tray/Full & Compact install/rollback tests. The only difference between runtime SHA ed8 and installer SHA 402 is Linux test fixture file-mode setup, no runtime code changes.
- Correct Windows CI artifact: `12562833876`, `light-remote-windows-x64-402dc6955e7a6e2ead852c70d89359b308cd93d5`, available at `https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40101661100/artifacts/12562833876`. ZIP SHA256 `31e71b9ec2aa4c18b4c5b6b33fbd5015be5e7943b9576ce006b465ab44c6e97a`. Full setup `175266543` bytes SHA256 `d640f7189a0383e068361523dbe845648d618a4c6af242aea0e194393afed332`; Compact setup `154329101` bytes SHA256 `8d31f83506a7edadf2031e116a632ba4fe15f394279086e606f8da524e983eb2`. Same installer AppId/tasks as prior Windows Gold client: **an install will REPLACE current Windows client; no automatic install was performed**.
- Created a separate **synthetic-only scope** in the UAT Gold Wall database `7a115f4f-bbed-4565-8493-31fa92ebebb3` with one synthetic Home checkpoint `399ceeb0-ce77-447c-95de-2102ac603d39` and owner-approved Windows key grant solely for testing. Scope is distinct from Light Remote/LightBI production memory, and its Home+Windows route remains opted OUT on Windows. This grant is keyed to the Windows test identity, NOT the yet-uninitialized actual production Windows Memory identity.
- Attempt to execute the real signed pull+ACK test script against this endpoint from current Windows Gold client was **blocked by the tool platform safety check before running**. No bypass attempted, no false PASS claim. Read-only actual ARM UAT after cutover confirmed legacy V1 `device_hmac_verified`, G2 Auto rev1 `home_ed25519_verified`, G3 test rev1 `home_ed25519_verified`, legacy unassigned count 3, both optional modules ON, Codex Plus connected, old Task Controller task still `todo`; synthetic G3 peer's `ackRevision` still NULL. **Real signed peer HTTP roundtrip and automatic background polling are NOT YET PASSED.**
- Final next gate: owner installs new Windows GitHub artifact (same AppId collision acknowledged), approve a real per-device HOME/Replica grant using authenticated account enrollment, choose NetBird Home URL under the Replica scope, opt-in polling, verify Home gets ACK for TWO consecutive Home revisions after a reboot/reconnect and no data from other scopes, then revoke synthetic grant if no longer needed. Never send user project Memory through ChatGPT test scripts or store on Gold Operator server. G4 relay remains NOT implemented.

## G3 PEER RESPONSE AUTHENTICITY PATCH — 2026-10-24
- On actual `DESKTOP-VA16D27` Gold connection `ready`, installed `0.9.0-rc.49` client was checked: `gold-memory-sync.mjs` exists, but **`gold-memory-peer.mjs` is missing**. Therefore owner has NOT installed Windows NetBird P2P build 402dc yet. Existing Windows running Scheduled Task `LightRemoteDeviceAgent` remains Running. Do not silently replace this client or claim true autonomous P2P acceptance.
- Security finding: Home E2EE frames carry an Ed25519 signature, and Replica requests / ACKs were signed, but Home HTTP response `up_to_date` and ACK success response were previously **not signed nor correlated to the request nonce**. A fabricated/replayed HTTP success could cause Replica to report wrong remote revision even though the actual checkpoint signatures remained safe.
- Fix `device-agent/gold-memory-peer.mjs`: Home now signs the COMPLETE peer response envelope `{protocol,accountId,homeDeviceId,deviceId,scopeId,action,requestNonce,result}` with its Home device Ed25519 private key. Replica validates all request fields + Home public key signature before trusting **frame, up_to_date or ACK**. Nonce binding rejects replay from earlier request, including signed old status. No secrets/actual Memory data in logs.
- Added unit regressions to `deploy/scripts/selftest-gold-memory-peer-v3.mjs`: forged `up_to_date`, tampered signed frame response, mismatched nonce, plus real signed response/ACK, existing scope/CSRF, G1/G2/V1 tests. Local ARM tests PASS; Windows build and actual UAT deployment pending in this commit.
- Once CI passes, user must install the NEW Windows installer for this response-verification protocol. An older P2P Windows build 402dc cannot interoperate with the now signed response envelope; upgrade both Home and Replica coherently. Do not enable replica background polling before confirming actual Windows client version and per-scope grant.

## G3 SIGNED RESPONSE FINAL UAT + WINDOWS CI — VERIFIED 2026-10-24
- Implemented and pushed source commit `36af511629632f19e49faf1fb2acf934cfc512a8`: Home now signs EVERY P2P response envelope (frame, up_to_date, ack) with Ed25519 over exact device/account/scope/action/requestNonce/result; Replica rejects forged status and replayed responses before accepting state. Added failed-forgery and nonce-replay regression cases, existing G1/G2/G3 regression PASS.
- Existing single LXD Gold UAT `light-remote-gold-uat` updated to SAME source `36af511629632f19e49faf1fb2acf934cfc512a8`; pre-cutover snapshot `gold-before-g3-signed-response-20261024` preserved. Four Gold systemd services ACTIVE, Wall HTTP 200. After restart read-only: V1 `device_hmac_verified`, G2 Auto checkpoint revision 1 `home_ed25519_verified`, G3 synthetic Home checkpoint revision 1 `home_ed25519_verified`, two modules ON, Codex Plus connected, old Task Controller task `todo`. Synthetic direct-NetBird scope Windows `ackRevision` still NULL: **NO real signed pull/ack through Windows Agent has passed yet**.
- Direct Windows `DESKTOP-VA16D27` reachability to Gold UAT peer endpoint still PASS; unsigned request rejected HTTP 403 after the new cutover. Current installed Windows client was inspected and still lacks `gold-memory-peer.mjs`; owner has not installed this latest P2P build in this turn.
- **Windows GitHub Actions build `40102874591` COMPLETED SUCCESS** at source `36af511629632f19e49faf1fb2acf934cfc512a8`, including G3 signed response forged-up-to-date test on actual Windows runner, legacy Memory tests, 100-file Client package, Native Tray, Full & Compact installer/update/rollback/uninstall. Verified artifact `12563850663`, ZIP name `light-remote-windows-x64-36af511629632f19e49faf1fb2acf934cfc512a8`, ZIP digest `sha256:0cd257078f98e4c184f75030b4159cd11e5a794f937157dfd0843b91c0dfb16c`. Artifact link: `https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40102874591/artifacts/12563850663`. Artifact expires 2026-11-07.
- Windows ZIP contains Full `Light-Remote-MCP-Setup-x64.exe` (175268307 bytes, SHA256 `64c890e0feff475fe80843043783ac77a645834449d42dd4d62042db72035587`) and Compact `Light-Remote-MCP-Compact-Setup-x64.exe` (154326203 bytes, SHA256 `94e63323a9e8caa3203225363969fd896cd6ad97aedbd417dc22f16a7b63ce51`), `SHA256SUMS.txt`.
- **ATTENTION**: Installer uses same Windows AppId/tasks and will REPLACE existing Windows client. No installation was initiated by assistant, preserving user's current working setup. Old 402dc P2P build is incompatible with Home-signed HTTP result envelope; use ONLY this newer 36af build when accepting NetBird P2P.
- Next acceptance: Owner installs above Windows UAT; verify installed source SHA via `gold-memory-peer.mjs` hash against 36af, verify exact Gold Account identity and peer grant; activate only explicitly approved synthetic scope and NetBird Home route; show actual P2P pull + ACK revision 1 and a new revision 2, then restart Windows Agent, verify automatic reconnection and correct scope isolation. No G4 relay or cloud storage. Production unchanged.

## G3 OWNER UI PEER AUTHORIZATION (2026-10-24)
- Windows `DESKTOP-VA16D27` installed the P2P build. Live native module `gold-memory-peer.mjs` normalized-LF SHA256 = `0f75e9a7a83c9b81ef25272bf4d95c24112ed3b28e4f2d6566c72d81c8ffee5d`, EXACT match with ARM source `36af511629632f19e49faf1fb2acf934cfc512a8` (raw Windows CRLF digest differs). Scheduled Task `LightRemoteDeviceAgent` Running. On the REAL Windows Gold Memory SQLite: Long Memory + Codex ON, zero Memory Scopes, zero peer routes and no real Sync Ed25519/X25519 key pair yet. ARM synthetic scope `7a115f4f-bbed-4565-8493-31fa92ebebb3` remains at revision 1, `ackRevision=NULL`; no real P2P success asserted.
- A request from ChatGPT through Light Remote to initialize the Windows real Memory identity **was denied by the platform safety check** before execution. The denial was respected, with no alternate-command retry or privilege bypass. Therefore **do not claim any real Windows pairing or auto sync has completed**.
- The missing ergonomic feature was confirmed: existing Gold Wall owner/CSRF REST APIs already supported public key identity, scoped signed grant, invitation acceptance, grant revoke and NetBird route, but UI exposed only identity fingerprint, policy and route; no owner-operated grant/accept interface.
- Implemented a single expanded `Pair a Memory Home and Replica (owner approval)` workflow directly in EXISTING Gold Wall: export this device PUBLIC identity (never private key), copy identity, paste remote public peer identity, input separately verified fingerprint, grant ONLY selected scope with owner confirmation, copy Home-signed invitation, paste invitation on Replica, verify Home fingerprint separately, accept, then explicitly enable 45s NetBird polling if desired. Revoke a Replica on Home per selected scope with owner confirmation; warns remote data already received cannot be erased.
- All sensitive mutations continue to use existing owner-authenticated, CSRF-checked APIs; approval checkbox reset after any successful grant/accept/revoke. Peer route remains disabled by default, and no project scope auto-sync is enabled. Clipboard falls back to manual Ctrl+C over nonsecure NetBird HTTP.
- Code-level UI existence checks and JS parsing added to existing Gold cross-session selftest; native G3 P2P crypto/replay, G2 Auto, G1/V1, packaging 100 files, frozen #486 parity and all required Wall assets PASS.
- NEXT: build and deploy this owner pairing UI as one Gold UAT candidate, run Windows CI from same branch and distribute update installer. The owner must then use the Walls of BOTH approved devices to establish exact per-scope fingerprint grants, followed by a real NetBird revision 1/2 autonomous polling and signed ACK acceptance. Do not use remote exec or a different tool to retry previously refused private-key initialization.

## G3 ACCOUNT-FIRST DEVICE DISCOVERY / UX RCA — 2026-10-24
- Owner flagged a **product UX architecture failure** visible in Windows Wall screenshots: G3 normal UI demanded `Home NetBird URL` and manual public identity/fingerprint/invitation exchange. THIS IS NOT THE INTENDED Light Remote account-based sync UX. Do not ask end users for IPs, NetBird configuration or copy/paste cryptographic JSON.
- Correct product abstraction: One Light Remote Account's verified enrolled device directory (deviceId, displayName, platform, online/offline), per-scope Home owner selection, selected Replica devices, owner-confirmed grant and data-sharing purpose. Gold internally routes directly if reachable; if impossible, use bounded E2EE-only relay without storing note contents in server databases/disks. Offline Home retains local durable outbox; no silent Home reassignment/split-brain.
- Added signed `POST /v1/device-channel/memory-peers` on existing Gold Operator, using enrollment-backed `verifiedChannelContext` to derive true account+device binding, never accepting caller `accountId` as authority. Returns at most 100 non-revoked devices of SAME account with minimal UI info only. Does not return keys, secrets, checkpoint bodies or unrelated account members.
- Existing Agent requests the roster through its signed `channelRequest(state,hub,'memory-peers',{})`; existing owner/CSRF Gold Wall offers `GET /api/gold/modules/sync/account-devices` backed by that verified request. Page auto-loads account device roster; user-facing NetBird/IP/polling fields are hidden (legacy diagnostic API remains internal for now).
- Security and UI tests: signed context used, fake unrelated account and revoked devices omitted, owner auth required to access Wall directory, Wall JS parses and package parity remains 100 files / 90 immutable Gold #486 preserved; G1/G2/G3 regressions PASS.
- **Milestone boundary: DIRECTORY ONLY, NOT ACCOUNT-BASED SYNC YET.** No automatic Home route resolution, account-wide encrypted scope catalog or server streaming relay in this change. Do not advertise account-based auto P2P as available. Must build service-level rendezvous/recipient availability with safe direct/relay paths and explicit owner grant, preserving no Memory payload persistence. No existing Windows client reinstalled in this step.
- After broker/routing is implemented and tested, the *final user-facing* interaction should reduce to: choose Home device, choose scope(s) and allowed Replica devices, click Approve Sync; show in-sync/behind/offline/needs-approval. Public key comparison is internal automated via enrolled account device keys (or explicit trust-on-first-use confirmation), never expose key exchange JSON in normal UI. Keep optional diagnostics in Admin/Advanced for technical users only.


### APPENDIX B — FULL ARCHIVE G3 ACCOUNT SYNC HANDOFF START

# Gold Memory Sync — Account-wide per-device modes (2026-10-25)

## Owner product requirement

From ANY enrolled Gold Wall in one Account, configure the SAME canonical device list:
- One **Sync ON/OFF** control for the Account. OFF pauses transfers without deleting already received local data or issuing grant rotations.
- Checkbox per enrolled device. Unchecked stops future shared updates/recipient grants. Checkboxes and modes stay visible across all Walls.
- Three selectors BEHIND each selected device: **Auto / Follow Project / Manual**, independent per device. ARM Auto, Windows Manual and macOS Follow Project must work together.
- Manual device has a small **Sync now** operation. No Home URL, IP, copy/paste key, fingerprint or second-Wall accept ceremony. Require owner Wall auth+CSRF and signed Agent enrollment.
- The **sync mode** is a transport policy for the device, NOT the separate **capture mode** for an individual scope. Codex Bridge remains independent.

## Meaning of per-device sync mode

**Auto**: when Account Sync is ON and the device is checked, automatically exchange *authorized* checkpoint deltas and signed evidence with corresponding scope Homes.

**Follow Project**: only exchange scopes with a verified binding of workspace, repository or work_context. Unbound scopes remain unassigned/unsynced; NEVER infer membership from displayName or fuzzy matching. Scope Home remains authoritative.

**Manual**: no automatic delivery of new Home revisions. The owner clicks **Sync now**. Operator increments a durable per-device manual_request_seq; every scope Home snapshots the authorized head revision for that request in local SQLite. Only revisions at or below that ceiling can be sent, even after a later checkpoint is created. A new request can advance the ceiling.

Each device may have a different mode, even when both store replicas of the same scope. Home-side and receiver-side policy gates BOTH apply. A different device can be Home for a different scope; the Wall being open is NOT the default Home for the whole Account.

## Data boundaries

- Operator PostgreSQL canonical metadata ONLY: normalized `lr_gold_memory_sync_accounts` and `lr_gold_memory_sync_devices` tables with account_id, device_id, checked, mode, revision/CAS and manual sequence. NO checkpoint payloads, transcript, secrets or JSONB snapshot tables.
- Redis is Gold runtime transport/cache when applicable, NOT canonical Memory data.
- Device local SQLite continues to own scoped checkpoints, verified event journal, signatures, outbox/ACK and durable per-scope Manual ceilings.
- Account policy cannot grant other-account device IDs; signed enrollment binds every Agent channel to account ID and device ID. Local Wall mutation requires owner authentication + CSRF. Server MUST recheck account roster/disabled policy before relaying ciphertext or forwarding invitations.
- Gold Relay may hold only bounded TTL E2EE frames in RAM, never PG/Redis/disk/log payloads. Prefer direct P2P when safe and capable; both transports respect the same Sync OFF and per-device mode checks.
- Disabling Sync does not revoke existing local copies. Unchecking a device revokes future membership/grants when each Home reconciles its scoped authorizations; allow for propagation latency/offline sources. No promise of secure remote deletion.
- Device key rotation must fence old grants; one Home writer per scope and home_epoch avoids split-brain.

## Integration code slice

- `operator-host/gold-memory-account-sync-policy.mjs`: normalized PG account policy + CAS and manual trigger.
- `operator-host/executor-routes-device-channel.mjs` / `plugin-server/device-public.mjs`: enrollment-signed get/set/manual and account-selected relay/invite gates.
- `device-agent/operator-agent.mjs`: account policy polling, per-device membership/mode and Home/Replica sync policy gating; invite offers remain signed and local checkpoint content is E2EE.
- `device-agent/gold-wall-modules.mjs`: verified project binding check and durable Manual revision ceiling per scope/peer.
- `device-agent/local-wall.mjs`: unified account device rows and per-row 3-mode choices, Home P2P policy checks, owner+CSRF writes.
- `deploy/scripts/selftest-gold-memory-device-modes.mjs` / `selftest-gold-memory-account-ui.mjs`: three different device modes, account isolation, stale policy revision, Manual ceiling, owner+CSRF, cross-Wall consistency at mock transport boundary.

## IMPORTANT gates NOT accepted by these source unit tests

1. On Gold UAT, PostgreSQL migration/table initialization, signed Device Channel roundtrip and exact cross-Wall persisted policy must be verified after deployment. Unit PG harness is not a live database acceptance.
2. Both UAT ARM and Windows need compatible Gold Agent code; Windows staged candidate alone is not an installed/runtime verification. Perform 2 encrypted checkpoint revisions, ACK, offline/reconnect and Manual revision fencing on REAL devices.
3. **Replica → Home signed typed event/evidence contribution** is not yet covered by existing checkpoint-only G3 protocol. It needs durable outbox, authorized source scope routing, Home re-ingestion and single-authority coalescing, rather than multiple writers.
4. Home directory by scope, multi-device manifest/hash divergence reconciliation, source provenance, quarantine, fail-closed stale replica restore and authenticated Home migration need separate E2E gates. Account-global policy should not be confused with a global canonical Home.
5. Follow Project cross-OS real project bindings (Windows/Linux/macOS paths) and true P2P prioritization per device mode need OS parity acceptance. Do not mark G3/G4/G5/G6 fully PASS from source tests.
6. Owner-intent security assurance: the signed device channel is a trusted agent acting for an owner-authenticated Wall. A future hardening pass should explicitly bind owner approvals to a server-verifiable short-lived principal without requiring routine extra user prompts.

## Source/rollback

Branch `feature/gold-m6-integrated-20261023` only. Keep Gold production untouched, source rollback tag `gold-restore-before-memory-codex-20261024`, and UAT LXD snapshot `gold-before-one-switch-memory-sync-20261025`. Do not restart active Windows client without verified recovery and owner-aware rollout. Legacy per-Home `lm_sync_device_selection` is kept for backward compatibility but MUST NOT be the policy backing the new Account-wide UI.

## UAT 2026-10-25 11:40+07 (verified, not planned)

- Source HEAD `55a28ee377aa4894567737359cd3e29a9b8d7de5`, Gold UAT current four systemd services `active` on matching SHA, only LXD `light-remote-gold-uat`; no Gold production change. Pre-schema snapshot `gold-before-account-sync-sql036-20261025` exists.
- Initial UAT signed device-channel GET failed because `lr_gold_app` intentionally lacks `CREATE` on public schema. Resolved with migration `036_gold_memory_account_sync_modes.sql` applied ONCE by separate `lr_gold_migrator`, manifest hashes verified. SQL ledger version `36`, Operator remains DML-only (no extra privileges).
- Actual enrolled UAT device made signed `memory-sync-policy?action=get` via Gold Plugin to Operator; verified two devices, revision `0`, global Sync `OFF`, both devices unselected, default individual mode `Auto`; checkpoint payload transfer `false`. **Real PostgreSQL READ gate PASS.**
- `db9c438` updates old CI source contract to locate immutable SQL 035 by version instead of assuming 035 remains last; `55a28ee` fences old clients without `syncModeProtocol=1` from granting or accepting Memory changes. GitHub Gold Native Wall Modules Parity for `55a28ee` succeeded at last query; Windows/Linux/Operator workflows may still be in progress.
- On real Windows `DESKTOP-VA16D27`, installed client does **not** yet implement `memoryAccountSyncPolicy`. The new source `55a28ee` is staged separately under `%LOCALAPPDATA%\\Light Remote\\G3-DeviceMode-55a28ee`: 101/101 hash-verified files and per-device-mode tests PASS, **NOT INSTALLED**. Owner-facing UI must show this outdated device as not yet mode-capable. No Windows install/restart executed.
- Remaining gates: real owner Account policy WRITE/read-back across independent Walls, Windows runtime upgrade plus real Home↔Replica checkpoint+ACK/offline reconciliation, Replica→Home typed evidence, per-scope authoritative Home routing/multi-device manifest and true multi-OS parity. Never claim full G3/G4/G5/G6 PASS from metadata/unit tests.

## 2026-10-25 — English Wall and real UAT ↔ Windows installer acceptance

- Source tested: `ccd102b8146dd994e6b0f7f205e43aa4caf3050c`, branch `feature/gold-m6-integrated-20261023`. All remaining Vietnamese visible strings in `device-agent/local-wall.mjs` converted to English. Wall UI/account-policy and filesystem owner regression tests passed, Gold Native Wall Parity CI passed.
- UAT LXD snapshot: `gold-before-english-windows-sync-20261025`. UAT four services (Operator, Plugin, Supervisor, Wall) active on `ccd102b` and retained PostgreSQL migration ledger v36; production ARM host/Wall unchanged.
- Windows Tray CI official installer run `40165305011` SUCCESS: artifact `light-remote-windows-x64-ccd102b8146dd994e6b0f7f205e43aa4caf3050c`, ZIP SHA-256 `a20eac9b5bae63fead3db29f44893edb6fdb87dda8d855e8b35e5ac6d2065030`; full installer `175279272` bytes SHA-256 `62b24c5aa70a403d6ef86f03ca6eae01c8531e6e413ad88e3ec43ef150f999b4`. Verified on Windows before install.
- Windows `DESKTOP-VA16D27`: backed up 418 installed-client files + Scheduled Task export under `%LOCALAPPDATA%\\Light Remote\\Gold-UAT-ccd102b\\backup`. Installed full UAT Windows installer through independent task, receipt `RESULT=PASS`. Running Agent task recovered; installed `operator-agent.mjs`, `local-wall.mjs` and `gold-wall-modules.mjs` SHA-256 equal verified candidate source `ccd102b`. One-time install task and temporary 328MB ZIP removed; rollback backup and 175MB full setup retained.
- Initial owner Account policy was `revision=4`, `enabled=true`, Windows selected Auto; UAT ARM *unselected* Auto. To run two-device acceptance, used the enrolled UAT Agent's signed Operator channel to temporarily select ARM too (`revision=5`). Both Agent identities advertised `syncModeProtocol=1`. Test was scoped to the existing `G3 NETBIRD DIRECT SYNTHETIC UAT` and `Gold G2 Auto UAT (2026-10-24)` scopes only.
- **Real E2E PASS, not synthetic courier**: Windows local SQLite was initially 0 scopes, then automatically received both ARM Home scopes. Windows independently called `goldScopedHandoff` from installed source: both revision 1 signed Home checkpoints verified, with head hashes `0a0e4cd5f7387e37516dddef3e89b7354d6804289c3b71f3f2f9e81bd7df67df` and `76ee47d9fdcf20d45f3778357c949d686013bb2b1cfbfc4d26c64d1b343a36fa`. Home durable SQLite `lm_replica_ack` reported revision 1 for both.
- A second, clearly marked synthetic checkpoint was written exclusively by the UAT Home onto scope `7a115f4f-bbed-4565-8493-31fa92ebebb3`. New revision=2 signed `home_ed25519_signed`, hash `a8d7ed2f689e890ca343455725e8212723fd216f31680234015dd1511a4f3fcd`. Windows automatically received revision 2, independently verified signature and chain with exact same hash, and ARM received **ACK revision 2/2**. No database copying or ChatGPT courier.
- Owner's original Account device selection **restored** after test at revision 6: `Sync ON`, Windows selected/Auto, ARM unselected/Auto. Synced ciphertext-derived local Memory copies remain; no remote deletion is claimed.
- **Not yet PASS**: Replica→Home signed typed event contribution; multi-scope Home routing from different sources; P2P direct prioritization on real Windows; Follow Project and Manual E2E with real Windows; offline/reconnect revision divergence; full ChatGPT new-session scoped restore; macOS parity. Owner UX has one issue to examine separately: selecting only Windows but not the UAT Home prevents ARM-originated sync, so the UI should clearly communicate source membership or handle implicit Home participation. Do not turn this into extra required IP/JSON steps.


## 2026-10-25 — English UI, Windows Gold UAT, real Manual E2E and Codex ACL RCA

**Release source:** `8a8c40c3f998032ab25b6cfbf54f3935d61ce70f` in `feature/gold-m6-integrated-20261023`, after `ccd102b` English Wall and `1658567` earlier E2E handoff. Gold UAT LXD `light-remote-gold-uat` four services `active`, running source `8a8c40c`. UAT pre-upgrade snapshot `gold-before-codex-acl-and-sync-status-20261025` exists. **Do not alter Gold production or rollback tags.**

Windows native installer was built from the exact source SHA by [Windows Tray Client CI run 40167770765](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40167770765), with **four CI workflows green** (Windows, Gold Native Wall Modules Parity, Gold G3 Operator Regression and Linux Packages). Artifact `light-remote-windows-x64-8a8c40c3f998032ab25b6cfbf54f3935d61ce70f` ZIP SHA256 `63a3c89a97ac180d0fe3df50b84be1178f22afc8631661569482db0612178ef5`, full installer SHA256 `05d8c3edc0893005ed251177505d777ff1f8e423cb2d82d8c5cb93338ef70d5e`. Installer staged under Windows `%LOCALAPPDATA%\\Light Remote\\Gold-UAT-8a8c40c\\installer\\`, old client backed up in that directory's `backup\\installed-client`, installed in existing per-user AppId via independent temporary Scheduled Task, and the temporary installer task was removed afterward.

**Windows install verified:** installer exit 0; independent stage and verification of **101/101 client core files**; exact SHA-256 file comparison PASS for `operator-agent.mjs`, `local-wall.mjs`, `gold-codex-plus.mjs`, `gold-wall-modules.mjs`; scheduled `LightRemoteDeviceAgent` Running; signed scoped Memory record validation on Windows PASS. An early scripted post-install validation erroneously used positional PowerShell `Select-String` arguments, causing a **false FAIL receipt** after a successful installer exit. Initial error is preserved as `initial-validator-false-negative.txt`; corrected independent receipt in `install-result.txt` documents PASS. Do not confuse this validation-script bug with installer failure.

**Real G3 Account E2E test:** devices `dev_e68276c691ba5413f42d5dde` (Home ARM) and `dev_8d0715fce77efffce4c5ed28` (Windows). Owner Account Sync ON, both selected, each Auto before test. Existing synthetic scope `7a115f4f-bbed-4565-8493-31fa92ebebb3` had Home=ARM, replica Windows, **revision 2/2 signed ACK verified**. Switched **only Windows** to Manual using signed Account policy revision 10, appended a synthetic signed Home checkpoint revision 3, observed Windows held revision 2 and Home ACK 2. Issued `memory-sync-policy action=manual` with durable `manualRequestSeq=1`; Home set local Manual cap to revision 3, reauthorized encrypted grant `grant_epoch=3`, Windows received signed revision 3, Home persisted signed ACK **3/3**. Win head hash `fea737052ba96230f33acc3f7e9b598c61a34a9574865f6509f94dc95bd33fea` matches Home. Thus **real Auto and Manual Home → Windows → ACK gates PASS** on actual devices, without copying the database between hosts.

**Post-test Account policy:** An interleaved owner/UI update advanced policy revision to 12. The scripted restore intentionally failed CAS instead of overwriting that newer config. Fresh signed read confirmed global Sync `enabled=true`, **both ARM and Windows selected, both mode=auto**, Windows manual_request_seq=1 (historic counter only). Do not call a forced restore; desired user-visible policy is already Auto on both. In later sessions, always read current policy, not the historical revision.

**UI corrected:** all Gold Memory Sync user-facing Vietnamese strings translated into standard English; changed the hardcoded misleading `Awaiting verified revision` label into `Sync enabled · Check scope revisions`. This does **not** claim live per-device revision telemetry; actual signed revision and ACK state remains in local scoped Memory ledger. Designing a true account-level per-device verified status display remains open.

**Windows Codex Bridge unrelated blocker:** `codex_home_permissions` was a POSIX mode check incorrectly applied to Windows. Fixed by owner SID-only explicit NTFS ACL via `icacls`; Windows test PASS; installed Windows `codex-home` ACL inheritance is protected. Actual installed bridge probe now reports `codex_binary_missing`: the Windows Codex app-server executable is **not present**; it remains an independent OPEN gate, not solved by ACL alone. Codex remains optional; Long Memory E2EE Sync worked independently.

**Open gates:** Follow Project mode *real* Windows/Linux scoped bound/unbound E2E, Replica→Home signed evidence and unique scope-authority reconciliation, offline/reconnection conflict and stale restore tests, true per-device revision summary on Wall, and Windows Codex binary packaging/discovery. No claim that the whole G3–G6 roadmap is complete. Keep Account PostgreSQL metadata separate from SQLite private Memory, and preserve the unchanged Gold UI/admin surfaces.

## G3 Replica → Home typed evidence protocol (development handoff)

- `device-agent/gold-memory-evidence.mjs` now implements a local-first, bounded,
  per-scope Replica contribution protocol. An enrolled Replica with an active
  signed Home grant creates a typed event (`test_receipt`, `fs_change`,
  `task_state_changed`, `operator_receipt`, or `manual_note`). The event
  is signed using its own Ed25519 device key and encrypted for the scope Home
  with ephemeral X25519/HKDF/AES-256-GCM; the relay never sees the body.
- The Replica stores ciphertext in `lm_evidence_outbox` SQLite before
  transport. The Operator's `memory-relay` has volatile `push_evidence`,
  `pull_evidence`, `push_evidence_ack`, and `pull_evidence_acks` actions,
  with enrolled account membership and selected-device authorization. No
  event body, decrypted payload, SQLite, or secret is in PG/Redis/cloud logs.
- The Home checks account, exact scope authority, Home epoch, grant ID,
  non-revoked Replica member and Ed25519 signature, decrypts the event, and
  commits the provenance-tagged checkpoint and idempotency receipt in ONE
  SQLite transaction. The Home's signed ACK carries its newly authoritative
  checkpoint/revision back to the Replica. Retries do not double-commit.
- The Gold Agent relay worker polls inbound events/ACKs and drains the
  Replica's bounded persistent outbox, with account per-device policy checks.
  Replica Manual *event contribution* is deliberately deferred: manual
  mode never silently drains the evidence queue. Ordinary Manual
  Home→Replica checkpoints remain implemented and E2E PASS.
- Unit/regression receipt:
  `GOLD_REPLICA_TO_HOME_E2EE_SIGNED_TYPED_EVENT_ATOMIC_COMMIT_REPLAY_RESTART_REVOCATION_PASS`;
  also checks relay envelope, account isolation, duplicate ACK, revoke,
  outbox persistence across restart, and Home→Replica round-trip of the new
  Home-signed checkpoint. Canonical Windows core manifest now contains
  **102 files** (was 101) including `gold-memory-evidence.mjs`.
- **Not yet a feature-complete claim:** automatic selection of which
  Replica-local operator/PTY/codex events to contribute requires a typed
  source adapter and owner-scoped provenance filter; Home↔Windows real
  event ingestion, offline/reconnect, manual-source trigger, source-side
  Follow Project binding proof propagation and full scope manifest
  reconciliation remain independent acceptance gates. Use only synthetic
  authorized UAT event for live test.

## LIVE G3 acceptance 2026-10-25 — Follow Project and Replica → Home

**UAT source SHA:** `43c5fe3973a3f7c04a9f099269381aebc42c64b5`, branch
`feature/gold-m6-integrated-20261023`, four Gold UAT systemd services
`active`. Snapshot `gold-before-g3-replica-evidence-20261025` exists;
Gold production untouched. Four CI workflows for SHA `43c5fe3` succeeded:
Windows Tray Client run `40169773812`, Linux Client Packages
`40169773693`, Gold G3 Operator Regression `40169773707`, Gold Native
Wall Modules Parity `40169773751`.

**Windows distribution:** native official artifact
`light-remote-windows-x64-43c5fe3973a3f7c04a9f099269381aebc42c64b5`;
ZIP SHA256 `395ad28f336df7596e685e0e44ac47c7aa293ee86d19cc38b197c5b859ae93b7`;
full EXE SHA256 `b2899ecbf4e4cef81d3d3a96f18b92a9a7f87aa1fd0145cebaa0ba59c32c44f0`.
Windows candidate was installed on `DESKTOP-VA16D27` via an independent
temporary Scheduled Task; installer return code 0, **102/102 installed core
hashes verify**, scheduled `LightRemoteDeviceAgent` Running, Windows evidence
regression PASS. Previous Windows client backed up under
`%LOCALAPPDATA%\\Light Remote\\Gold-UAT-43c5fe3\\backup\\installed-client`.
Temporary installer task unregistered after successful verification.

**Follow Project two-device test:** Gold ARM UAT was Auto; Windows was
temporarily `Follow Project`. Dedicated UAT synthetic scope
`d5e57c01-8864-4995-a186-01de2514ba79` had Home ARM. Checkpoint revision 1
without binding did **not** appear on Windows; after Home explicitly verified
and bound workspace `uat://gold/follow-project-20261025`, Home checkpoint
revision 2 was delivered to Windows, independently signature/hash verified.
Home `syncStatus` reported recipient `ackRevision=2`, `behind=0`.
Account policy then restored through CAS: revision **14**, global Sync ON,
**both devices selected and Auto**. No forced overwrite of owner settings.

**Replica → Home real encrypted event:** Windows submitted exactly one
synthetic `test_receipt`, event ID
`215d1dc4-9e5b-4d1e-9590-419b2fd49f16`, in the same isolated UAT scope.
The Windows outbox was locally durable and the Operator relayed only signed
E2EE ciphertext. ARM verified membership/grant/Epoch/Ed25519 and committed
the source-provenance checkpoint as **Home revision 3**, status `claimed`,
source `replica:dev_8d0715fce77efffce4c5ed28:windows-gold-uat:evidence-e2e`.
Home signed checkpoint hash:
`3faadac30eeff0e10085805df9295b2cf4c8745daec2acbd7fcc28212ea788fb`.
Windows evidence outbox then showed `state=acked`, `ackReceived=true`.
Home revision 3 was subsequently delivered back to Windows (hash equal);
ARM recorded **Replica ACK revision 3/3**. Both Windows and ARM remained online
and signed scope history independently validated. This is **real Windows →
ARM → Windows E2E PASS**, not SQLite copying or unit-only simulation.

**Remaining independently open:** offline/disconnect/reconnect full E2E
observations, automatic Replica-local PTY/Operator/Codex event capture adapter
and trusted provenance-to-scope mapping, Manual-mode device-origin evidence
(one-shot trigger semantics), multi-device manifest reconciliation and
signed Home rotation; macOS/Linux parity. Evidence contribution currently
uses volatile no-store E2EE relay (P2P support remains for Home→Replica
checkpoint frames), and no live production project content was transmitted.
The Codex Bridge Windows `codex_binary_missing` blocker remains unrelated.


## 2026-10-25 — Live Gold UAT G3 native filesystem Auto Sync (revision 6)

Source candidate `99b1d2fd3dbdd54c7f34b88033ba159e4560e8b2` is deployed on Windows `DESKTOP-VA16D27` and Linux ARM LXD `light-remote-gold-uat`. Four GitHub CI workflows passed: Windows Tray Client `40173440507`, Linux Client Packages `40173440579`, Gold G3 Operator Regression `40173440538`, and Gold Native Wall Modules Parity `40173440554`. Both devices run the same Gold memory protocol. Windows installed client verifies 102/102 core files and its scheduled Agent task is Running; ARM Gold UAT reports 4/4 services active. Gold production unchanged, no user project data touched.

**Native filesystem hook LIVE PASS:** Authenticated Gold tool `light_remote_write_file` wrote exactly one synthetic text fixture `G3_NATIVE_FS_UAT_20261025.txt` in the owner-bound Windows repository `%LOCALAPPDATA%\\Light Remote\\Gold-UAT-99b1d2f\\workspace`, already bound to synthetic scope `d5e57c01-8864-4995-a186-01de2514ba79` whose authoritative Home is `dev_e68276c691ba5413f42d5dde`. The Windows Agent autonomously observed its successful native fs write and saved signed, E2EE Replica event `8f0f5201-a5d2-5da4-a518-b7b971de7520` into device-local SQLite. No explicit Memory enqueue API was called. Home ARM committed **revision 6**, checkpoint source `replica:dev_8d0715fce77efffce4c5ed28:gold-agent:native-fs`, title `Verified filesystem write`, status `claimed`, signed head hash `456b287151e86121f33a934f0a101cc4aa7e9f62318b0cefc0daa811ea4a2aa0`. The Windows E2EE outbox marked the evidence event `acked`, and Windows then independently restored signed scoped revision **6** with the *same* head hash. Event ACK and Home-to-Replica ledger replication were both verified. The signed checkpoint ACK as viewed at ARM should still be confirmed separately if needed (the Windows revision-6 restore is confirmed).

**Already completed live gates:** Auto Home→Replica with signed ACK; Manual Home→Replica with request ceiling and signed ACK; Follow Project negative-unbound/positive-bound two-device test; signed Replica→Home typed contribution and reflected Home-signed checkpoint; Home Wall offline 95-second auto-restart with durable Windows E2EE outbox and automatic resumption; automatic Git HEAD capture (`11d9233` fixture commit → Home revision 5); this native FS capture (revision 6). Scope files, notes and evidence remain local-first; cloud relay only transports transient ciphertext. Account Sync settings were not changed by this native fs test.

**Open:** Full host/net disconnection and address-change testing (beyond stopping UAT Wall), multi-home/scope reconciliation and epoch fencing, Manual-origin one-shot Replica contribution, true per-device signed revision UI, PTY/Task Controller typed source adapters, cross-session ChatGPT restore, and macOS/Linux Desktop parity. Windows Codex app-server binary still needs its own packaging/lookup. Do not conflate the successful filesystem hook with all remaining G3/G4/G5/G6 gates.

## G3 Replica-origin Manual Sync — development candidate, 2026-10-25

This candidate extends `99b1d2f` (with the local UAT handoff commit `21c9b7d`) and is **not yet distributed to ARM / installed Windows clients**. It completes the source-level Manual-origin protocol:

- A Replica captures only a real verified Git HEAD/native filesystem effect in an owner-bound local workspace and queues signed E2EE evidence in SQLite even when its Account mode is Manual; Manual **never** sends without an explicit owner `Sync now` request.
- The signed account device policy tracks a monotonically advancing request sequence. Odd sequence values represent an approved one-shot batch; even values mean the approval was invalidated by OFF, deselection or mode transition. Returning Auto → Manual never silently restores an old grant. PostgreSQL schema 036 remains canonical; no DDL migration or cloud memory content added.
- On the first Agent observation of a permitted odd request sequence, SQLite durably freezes the outbox high-water row ID in `lm_evidence_manual_release`. Only events in that snapshot may be sent for this request; subsequent events require a later `Sync now`. The Replica signs an additional, per-event `manualRelease` authorization (account, device, scope, event ID, Home epoch, grant ID, sequence), without changing the original encrypted frame or the Home public key.
- Home validates the signed Manual release against the *current* Account request sequence, plus existing E2EE signature, scope/epoch, active grant, sender enrollment and deduplication. Tampered release, incorrect sequence, replay conflict and stale grant all fail closed. Event ACK and Home-signature checkpoint ACK remain independent.
- Windows local source tests PASS: signed E2EE round-trip, Manual seq 1 and 3, post-approval events withheld, restart-persistent cap, altered signature rejection, Account policy CAS and OFF/Auto→Manual invalidation. Windows source staging validated **103/103 files** (new `gold-memory-manual-evidence.mjs` included in client manifest).
- **Not yet PASS:** a fresh build/installer distributed to both Gold UAT and Windows, live Owner click → Manual Replica E2EE event → ARM Home revision/ACK, and full-device network-loss reconciliation. Existing live Auto/Follow Project/native FS receipt revision 6/6 from `99b1d2f` remains intact. Do not upgrade production or describe this candidate as shipped.

Note: a high-water rowid snapshot assumes local outbox rows remain append-only during a Manual batch. If future retention introduces deletion/reuse of SQLite rowids, replace the cap with a fixed signed event-ID manifest before enabling pruning.
