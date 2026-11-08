# Handoff gộp hai Windows app chính thành LightRemote.exe

Tài liệu chính: [T12 — Core EXE Consolidation Plan](LIGHT_REMOTE_CORE_EXE_CONSOLIDATION_PLAN_20261107.md).

Phạm vi Owner đã chốt: hợp nhất `GptOperator.Client.exe` và `desktop-v4/LightRemote.Desktop.exe` thành một file `LightRemote.exe` tại gốc cài đặt. `node.exe`, RM v2, updater/watchdog/uninstaller và các helper cần thiết được giữ riêng. Nhiều process/role từ cùng file chính là hợp lệ. Phải giữ GUI/tray, Owner/vault, Agent chạy nền, A/B, Wall, PTY, Long Memory/Codex và update/upgrade/rollback.

Kế hoạch có port host Windows hẹp sang Rust/Tauri, supervisor/Job Object, bridge/actions, task/installer paths, updater tương thích hai layout và migration hai chặng, CI/acceptance cùng cách đo hiệu năng. Đây là phương án chờ triển khai, chưa phải một bản LightRemote.exe đã build/kiểm thử.

[Coverage nhánh/commit/blob](LIGHT_REMOTE_CORE_EXE_BRANCH_COVERAGE_20261107.json) giữ nguyên snapshot lịch sử:69 tên nhánh/74 revision/18 đường dẫn/86 blob. [Review T11](LIGHT_REMOTE_SINGLE_CORE_EXE_BUILD_REVIEW_20261107.md) chỉ là tham khảo lịch sử; đề xuất nhúng Node/đổi PTY trong bản đó đã được T12 thay thế, không thuộc yêu cầu hiện hành.

Repo và điểm vào hiện hành: đọc Project Truth/Master Checkpoint tại gốc repo mới. Công việc T12-P0 tiếp theo phải kiểm lại caller contracts trên source mới, không dùng HEAD lịch sử hoặc mirror checkpoint về repo/worktree ARM cũ. Lần xuất bản này chỉ thêm tài liệu; implementation, native build và physical acceptance cho kiến trúc một EXE chưa bắt đầu. Bằng chứng CI/native của baseline hai EXE không chứng minh phương án gộp này.
