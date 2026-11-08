# LIGHT REMOTE — SECURITY HANDOFF: AB V2 ACCOUNT LOGIN RISK
Date: 2026-11-02
Status: DESIGN OPTIONS ONLY / OWNER DECISION PENDING / DO NOT IMPLEMENT OR ENABLE YET
Environment: GoldABV2 lab, preserve A/B V2 (Short ID 6+5, B 4+4, per-Agent 24h grant) and Work Anywhere / future IT Support.

## 1. Bối cảnh và ranh giới đã chốt
A/B V2 cho phép Owner ở bất kỳ đâu mở /account để duyệt B, không public Local Wall và không cần VPN/Tailscale. Giữ nguyên điều này. Device-local capability policy do người dùng tự quyết (kể cả sudo), không siết thêm quyền chỉ vì remote. Không dựa vào nickname/model/session của ChatGPT hoặc Claude để định danh Agent đáng tin.
Thiết bị mới hoặc đã Revoke = unowned -> Link qua Wall bởi bất kỳ account hợp lệ, kể cả chủ cũ. Thiết bị đang có chủ -> Relink từ Tray/App Windows/macOS hoặc admin Terminal Linux (SSH sudo hợp lệ), KHÔNG từ Wall. Không bắt console vật lý.
Threat cần đánh giá: người xấu có password/cookie /account có thể tự yêu cầu và phê duyệt B, được grant 24h với quyền thiết bị hiện có. Đây là account takeover, không sửa được chỉ bằng kiểm tra B, địa chỉ IP hoặc model Agent.

## 2. Các lựa chọn chủ sở hữu muốn cân nhắc (KHÔNG chốt)
A. New-device login challenge: phát hiện browser/device chưa có dấu tin cậy ở account; yêu cầu bước xác minh bổ sung trước khi phiên mới có quyền phê duyệt B. Dấu nhận diện browser chỉ là tín hiệu (cookie có thể bị copy), KHÔNG dùng fingerprint thụ động làm bằng chứng xác thực; dùng session binding và WebAuthn/passkey để tăng độ tin cậy khi cần.
B. Email Soft OTP: OTP ngắn hạn qua email đăng ký khi thiết bị đăng nhập lạ; mã one-time, lưu hash, chống replay, rate limit, cooldown, max attempts; không cho gửi OTP tới email vừa bị thay chưa xác minh. NHƯỢC: nếu email cũng bị chiếm, không ngăn được takeover; email OTP chậm và có thể gặp sự cố deliverability. Dùng làm giải pháp chuyển tiếp, không gọi là tương đương passkey.
C. Apple-like trusted-device approval: thông báo đến phiên/thiết bị chủ sở hữu ĐÃ TIN CẬY (không chỉ cùng account session), hiển thị trình duyệt, thời điểm, vị trí gần đúng, mục đích và nút Approve / Deny. Challenge phải ràng buộc với đúng login attempt, người xác nhận dùng khóa/passkey hoặc kênh đã đăng ký trước; không tin một phiên mới/đang xin phê duyệt tự xác nhận nó. Tránh phụ thuộc thiết bị đang offline; có mã recovery được giữ riêng và account recovery với delay hợp lý.
D. Concurrent login from different regions/time zones: event từ 2 sessions, 2 địa điểm xa nhau trong khoảng thời gian ngắn hoặc vùng múi giờ khác -> tăng risk score, có thể kích hoạt cảnh báo hoặc step-up. IP geo không chính xác; VPN/corporate proxy, roaming, NAT, travel, timezone browser tùy chỉnh gây false positives. KHÔNG khóa tài khoản cứng chỉ vì 2 IP/timezone khác nhau. Dùng thêm ASN, device-bound login credential, network reputation, session creation time, impossible travel conservative heuristics.
E. Email/push security notifications: gửi khi new device login, recovery, đổi mật khẩu, tạo grant B chưa từng có, thu hồi hàng loạt. Không gửi OTP/grant secret trong notification; nút Deny dẫn đến phiên xác thực chính thức. Throttle, audit, không leak danh sách thiết bị/địa chỉ trong token link.

## 3. Đề xuất roadmap thận trọng
P0 (không đổi UX): audit login event/session grant + secure logout/revoke all sessions, rate limit login/OTP/B; session rotation, CSRF/origin; chính xác revoke must invalidate active grants and session, fail closed. Verify existing code before declaring complete.
P1 (opt-in): mail notification cho thiết bị đăng nhập mới (đã có Zoho sender) + /account Sessions list with explicit sign out/deny. New browser remembered only with user consent and finite TTL. No intrusive step-up everywhere.
P2 (Owner decision): email Soft OTP khi login risk cao, fallback không spam; account recovery.
P3 (later): true trusted-device approve or passkeys/WebAuthn to cryptographically separate existing trusted device from compromised cloud password/session. 2FA optional/targeted, risk-based not blanket.
Không thay đổi A/B V2 protocol, 24h lifecycle, Agent permissions hay buộc local B; không bắt dùng VPN.

## 4. Chỗ cần xét code E2E trước khi triển khai
- operator-host/gold-ab-v2-owner-http.mjs owner B approval HTTP, current owner /account session+CSRF
- operator-host/gold-ab-v2-grant-operator.mjs and gold-ab-v2-grant-coordinator.mjs: signed enrollment/connection and durable PG grants
- operator-host/device-access-grant-registry.mjs: per-Agent 24h, revocation after account logout or device revoke
- plugin-server/account-portal/ab-v2.js and plugin-server/account-ab-v2.mjs: approval UX
- account/session registry and notifications mailer: signed-in sessions, new login challenge
Current lab has a verified new Owner after one Admin transfer; do not mutate account owner, grant, schema or SMTP for this handoff.

## 5. Các câu hỏi còn để Owner quyết
- Chỉ báo email khi login lạ hay bắt OTP ngay? Độ trễ và khôi phục tài khoản?
- Có passkey/trusted devices để duyệt login như iCloud không? Người chỉ có 1 thiết bị hoặc đi du lịch xử lý thế nào?
- Risk signals nào bật mặc định, ai có quyền tắt, giữ log IP bao lâu?
- Chính sách logout sessions khi nghi ngờ, kích hoạt có ngắt grant 24h đã cấp không?
Chưa có quyết định cuối cùng. KHÔNG được xem bản ghi này là yêu cầu tự động bật 2FA, OTP hay chặn vị trí.
