# READ FIRST — Libredesk + AI Support Gate, VPS-ARM

**Master handoff:** `docs/gold/RDC_GOLD_LIBREDESK_SUPPORT_GATE_MASTER_HANDOFF_20261027.md` (đọc mục 11 mới nhất trước).
**Ngày cập nhật:** 27/10/2026 ~09:29 ICT.

## Quyết định không thay đổi
- Light Remote = **Zoho Mail** `support@thaiduy.digital`; mailbox Zoho thật đã tồn tại, chưa cấu hình Libredesk.
- LightBI = **Lark Mail**; mới cấu hình domain, chưa tạo mailbox/chốt địa chỉ support. KHÔNG tự tạo tên email.
- Canonical: `https://support.thaiduy.digital/` Libredesk, `/ai-support/` Gate; một Libredesk Admin session; NetBird Traefik VPS-ARM.
- AI chỉ tạo nháp; người dùng mới duyệt/gửi; outbound mail vẫn **OFF**.
- Nhánh Gold `feature/gold-wall-account-notifications-20261026`; KHÔNG merge, Windows build, sửa ERPNext/Traefik/Gold Wall production; không xóa backups/volumes.

## Mốc đã hoàn thành trong session 27/10 tiếp theo
- Official Light Remote VPS-ARM, Light Remote Gold Windows Chrome đã được cấp phép, browser Libredesk System Admin hoạt động.
- P1 **native webhook đã tạo và Active**. Native UI Send test PASS, Gate PostgreSQL ghi thêm `webhook.test` (event id 3), HMAC cấu hình. Libredesk `webhooks=1`, Gate `support_gate_integration=1`.
- CSRF cookie raw fix trong `support-gate/src/server.mjs` khớp source đang deploy; kiểm tra source upstream Go; 9/9 Node tests PASS; committed `4dccb6f`. Không rebuild/deploy.
- Libredesk inboxes **0**. Form new Email -> Other provider đã mở nhưng Chrome autofill Gmail SAI: không dùng các trường Gmail tự điền, **chưa submit**. Mail send vẫn OFF.
- Health canonical HTTPS 200, 4 container support running, 4 Gold systemd active, ~21GB free.

## Việc tiếp theo thực sự
1. Owner mở Zoho Mail, xác minh IMAP enabled và Server Configuration Details theo account plan/DC. Nếu 2FA bật: tạo app-specific password ngay trong Zoho. Password chỉ nhập vào Libredesk UI, không chat/Git.
2. Tạo Light Remote Zoho Inbox trong Libredesk, đặt địa chỉ `support@thaiduy.digital`, thay hoàn toàn Gmail autofill, đúng IMAP/SMTP TLS; thử inbound từ email test có kiểm soát, kiểm tra native conversation và event Gate.
3. LightBI Lark: Owner cấu hình mailbox thật rồi chốt email support, mới tạo inbox thứ hai.
4. Cấp agent API tối thiểu, mapping inbox ID thật, kiểm tra message threading, xác thực Owner Approve/Send; sau đó mới AI worker qua official Light Remote.

**Rollback:** `/home/ubuntu/n8n2erpnext/support-gate-checkpoints/`; xem Master mục 7. Không bypass identity/webhook bằng SQL/PTY; không dùng credential Gmail tự điền.