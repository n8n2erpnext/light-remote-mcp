# Báo cáo LightRemote.exe và baseline hiện tại

Cập nhật 2026-11-09: candidate **0.10.1-dev.2** đã gộp hai app chính thành **LightRemote.exe**. Source build `31f23393aacb89b6d541cebb2cd0c2e1afa64538`, [CI #30: 9/9 PASS](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42549642811), [artifact bộ cài](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42549642811/artifacts/13645690974). SHA-256 bộ cài: `aac78a063f0628eac2966052fa0cd9e6650b5c2c6a1deb5048939e9a7b83ab19`. Native GUI/tray chạy trong file chính; mã Windows hiện hữu được nạp trong tiến trình qua WindowsHost DLL/private .NET8. Node/RM V2/updater/watchdog và các công cụ hỗ trợ vẫn tách riêng theo yêu cầu. Public binary release chưa đăng: automatic review yêu cầu Owner cho phép rõ trước khi đưa bộ cài thành link tải công khai.

CI Windows đã chạy cài mới, GUI/private CLR, shortcut/autostart, restart Agent giữ GUI ẩn, bridge upgrade/reinstall, lỗi health thật để rollback về bố cục cũ, watchdog khôi phục sau lỗi installer và gỡ cài đặt. PostgreSQL/Redis integration cũng PASS sau khi sửa race chờ server PostgreSQL cuối cùng. Source build đã fast-forward lên main qua required check, không force-push. Máy Owner/runtime ARM/feed công khai chưa thay đổi; nghiệm thu vật lý Owner/account/vault/B vẫn NOT_RUN. Máy đang dùng helper cũ cần qua compatibility bridge được pin trong config/windows-core-migration.json trước khi nâng lên primary.

Phần dưới là kết quả chuyển repo và runtime candidate **c03b50f** trước đây, giữ nguyên phạm vi lịch sử; không phải bằng chứng đã triển khai build mới lên ARM.

Repo chính thức: https://github.com/n8n2erpnext/light-remote-mcp — **ID mới 1450214328**, lịch sử mới bắt đầu từ aa378ba, không mang nhánh/tag/parent cũ. Bản code đã kiểm toán được xuất độc lập; kể từ push đầu tiên GitHub mới là nguồn phát triển và build.

Baseline build **0.10.0-dev.1**, commit `c03b50f4328e07138f350532c31dfc8b260311ce`, contract `light-remote.api.v1`. [CI mới 9/9 PASS](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42475715858): 270 Node tests, 69 lượt kiểm tra source theo phạm vi, 21 kiểm tra DEV thật, web/UI/security, native Mac/Linux source và bộ cài Windows/install/update/rollback/uninstall. Không coi CI là nghiệm thu GUI thực tế.

Bộ cài Windows artifact 13615761284 được kiểm tra lại trên ARM: ZIP SHA-256 `4a61c5b84ae009e8409a8e3e29fd76358c103a7b94f4c9e9f2db9983aa46136b`; installer SHA-256 `23b746d2b820da1303fa1834c8e9f2d83e1bcad66a9c8d0580532ae60358b52f`. Manifest ghi đúng commit/tree/run/profile; chưa xác minh ký mã và chưa cài lên máy Owner.

Sau CI, clone/fetch từ GitHub mới vào `/home/ubuntu/n8n2erpnext/light-remote-unified-20261108/conversion-20261108/runtime-from-github-c03b50f432` và chạy candidate `lru-c03b50f432-114436`: **21/21 integration PASS**, 3 container đang chạy, mạng nội bộ không mở port host. Không dùng source STAGED hoặc ghi đè backend đang phục vụ.

Đã thu hồi/chọn source theo subsystem: Desktop eb9a648 + core/native/Wall/Operator/Plugin; Gold mirror không có executable riêng bị bỏ sót; phục hồi Continuity, extension LM riêng và RC50. Toàn bộ phần prototype/chưa tích hợp vẫn được phân biệt rõ, không mặc định PASS.

Source/runtime ARM cũ và snapshot kiểm toán b250908 giữ nguyên làm mốc đối chiếu. Git đã lưu và phục hồi kiểm tra 2.285 refs; 22 releases/421 asset records/372 objects và 32 tệp metadata quản trị được bảo toàn. Repo GitHub cũ giữ tại https://github.com/n8n2erpnext/light-remote-mcp-archive-20261108 ở chế độ chỉ đọc: phiên quản trị thiếu quyền xoá, nên dùng đổi tên/lưu trữ rồi tạo repo mới đúng tên thay vì force-push.

main đã bắt buộc baseline-required, cấm force-push/xoá, áp dụng cả admin. CI mới không cần secrets; không nhập automation triển khai cũ. Chưa chuyển traffic, reset DB, đổi app đang cài hoặc phát hành update.

Còn thiếu: nghiệm thu native Windows với backend mới; local SSO; B-command mới; hook/DACL Continuity; prototype/Guest; package Mac/Linux đầy đủ; toàn bộ endpoint/schema; nghiệm thu vật lý candidate một EXE chính. Feed beta cũ được giữ nguyên chữ ký, riêng Fleet Wall còn URL release lịch sử cần migration có kiểm soát trước lần nâng cấp công khai. Chi tiết và thứ tự làm tiếp nằm trong KNOWN_ISSUES.md và ROADMAP.md.
