# Trạng thái repo Light Remote MCP mới

Repo chính thức vẫn là https://github.com/n8n2erpnext/light-remote-mcp nhưng có ID mới 1450214328, lịch sử Git mới và initial commit không có parent cũ. Source được xuất độc lập từ snapshot ARM b250908; source sản phẩm giữ nguyên so với mốc đã build eb6b2e6.

Phiên GitHub hiện tại có quyền quản trị/tạo/đổi tên nhưng thiếu scope xoá repo. Vì vậy repo cũ được giữ tại https://github.com/n8n2erpnext/light-remote-mcp-archive-20261108; repo mới được tạo đúng tên/URL chính thức. Không force-push. Đã lưu và xác minh phục hồi Git, release/artifact và metadata quản trị trên ARM. Không xuất giá trị secret.

Toàn bộ source/runtime ARM cũ và snapshot kiểm toán giữ nguyên để đối chiếu. Kể từ push đầu tiên, phát triển và build mới lấy từ GitHub mới. Initial commit phải chạy CI mới; bằng chứng CI cũ 8/8, 270 Node tests và 21 kiểm tra DEV thật là bằng chứng trước chuyển đổi.

Các thiếu sót sản phẩm vẫn được ghi trung thực trong KNOWN_ISSUES.md; chưa nghiệm thu GUI Windows với backend mới, chưa gộp hai EXE và chưa chuyển runtime chính.
