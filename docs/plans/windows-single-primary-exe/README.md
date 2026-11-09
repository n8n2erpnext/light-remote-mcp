# Handoff gộp hai Windows app chính thành LightRemote.exe

Tài liệu chính: [T12 — Core EXE Consolidation Plan](LIGHT_REMOTE_CORE_EXE_CONSOLIDATION_PLAN_20261107.md).

Phạm vi Owner đã chốt: hợp nhất `GptOperator.Client.exe` và `desktop-v4/LightRemote.Desktop.exe` thành một file `LightRemote.exe` tại gốc cài đặt. `node.exe`, RM v2, updater/watchdog/uninstaller và các helper cần thiết được giữ riêng. Nhiều process/role từ cùng file chính là hợp lệ. Phải giữ GUI/tray, Owner/vault, Agent chạy nền, A/B, Wall, PTY, Long Memory/Codex và update/upgrade/rollback.

Kế hoạch T12 bên dưới giữ nguyên như tài liệu thiết kế lịch sử. Triển khai hiện hành chọn hostfxr trong tiến trình để tái dùng mã Windows đã kiểm toán, thay vì port toàn bộ host hẹp sang Rust. Candidate0.10.1-dev.2 đã build và PASS toàn bộ CI #30, gồm package một EXE chính và migration hai layout. Đọc [Project Truth](../../../PROJECT_TRUTH.md), [Build/Deployment](../../../BUILD_AND_DEPLOYMENT.md) và [manifest hiện hành](../../evidence/windows-one-primary/PRIMARY_EXE_MANIFEST.json). Nghiệm thu vật lý Owner/account/vault/B vẫn NOT_RUN; không coi CI là đã nâng app máy Owner.

[Coverage nhánh/commit/blob](LIGHT_REMOTE_CORE_EXE_BRANCH_COVERAGE_20261107.json) giữ nguyên snapshot lịch sử:69 tên nhánh/74 revision/18 đường dẫn/86 blob. [Review T11](LIGHT_REMOTE_SINGLE_CORE_EXE_BUILD_REVIEW_20261107.md) chỉ là tham khảo lịch sử; đề xuất nhúng Node/đổi PTY trong bản đó đã được T12 thay thế, không thuộc yêu cầu hiện hành.

Repo và điểm vào hiện hành: đọc Project Truth/Master Checkpoint tại gốc repo chính thức. Source build31f2339, CI42549642811 PASS9/9; bản cài là artifact CI đã kiểm SHA-256, tag source windows/0.10.1-dev.2. Chưa đăng public binary release; bước này chờ Owner cho phép rõ sau khi automatic review chặn. Tiếp tục trên work trong workspace ARM đã duyệt; không dùng HEAD lịch sử hoặc mirror checkpoint về worktree cũ. Bằng chứng gộp hiện hành là manifest/CI của chính candidate này; bằng chứng vật lý cũ không được chuyển sang bản mới. Máy helper cũ cần qua compatibility bridge được pin trước khi nâng primary; Node/RM/helper vẫn giữ riêng.
