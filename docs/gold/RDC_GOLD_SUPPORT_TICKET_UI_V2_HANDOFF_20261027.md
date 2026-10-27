# Gold Support Ticket UI V2 — 2026-10-27 — LIVE UAT

## Owner-approved scope
Redesigned passwordless customer ticket view for Light Remote and LightBI, true server-side pagination (15 messages/page, First/Prev/[1]...[Last], default latest), dedicated A4 Print ready and real downloadable PDF with entire filtered conversation. Original PNG branding, signed 12-hour code-verified cookie, reply via web/email, one combined link+code acknowledgment, Closed+14d expiry, AI Auto-send OFF preserved. Gold Support Gate VPS-ARM only. Light Remote production, LibreDesk native core, Zoho/Lark, ERPNext, Windows Agent unchanged.

## Source and architecture
Branch: feature/gold-wall-account-notifications-20261026; pre-V2 HEAD: d603e6c.
- support-gate/src/public-ticket.mjs: responsive HTML, clear title/status/timeline and pager, precise system message exclusion, HTML escaping, private-link/code redaction, pagination and print query.
- support-gate/public/ticket.css: professional UI, mobile breakpoints, A4 print rules, hides form and UI controls in print. Original branded PNG files reused without editing.
- support-gate/public/print-ticket.js: external same-origin browser Print now button, no inline scripts.
- support-gate/src/ticket-pdf.mjs: PDFKit writer, A4, Unicode fonts from Alpine font-dejavu, correct original PNG icon per inbox, complete transcript and page numbering. Actual PDF download, not a browser print shortcut.
- support-gate/src/server.mjs: guarded GET /t/:uuid/print and GET /t/:uuid/pdf, ticket cookie check before any content. Main GET /t/:uuid?page=N. Printed routes also validate current ticket grant and closure expiry, same as ticket view.
- support-gate/src/ticket-access.mjs: records native outgoing acknowledgment numeric message ID after successful native API send in Gate metadata.
- support-gate/src/backfill-system-messages.mjs: explicit idempotent migration for previously-generated system acknowledgment IDs; never logs any code or transcript.
- support-gate/package.json, package-lock.json: pdfkit 0.17.2 added; npm audit production dependencies found 0 vulnerabilities.
- support-gate/Dockerfile adds Alpine font-dejavu. No font files linked to user.

## Database and pagination correctness
Additive PostgreSQL Gate table support_gate_ticket_system_messages(conversation_uuid uuid,native_message_id bigint,created_at; primary key conversation_uuid + native_message_id). Metadata only, not mail text/code. Existing native automatic acknowledgments were backfilled by exact protected-inbox patterns: SYSTEM_MESSAGE_BACKFILL_MATCHED=15, SYSTEM_MESSAGE_BACKFILL_INSERTED=15. Their IDs, rather than their words, are filtered when counting and showing the conversation. A small event Ticket created - Confirmation sent is shown instead. Bridge support_bridge.public_message view is read-only; ordered numeric message ID ASC, COUNT and LIMIT/OFFSET for 15/page. Print/PDF select all genuine messages separately up to MAX_EXPORT_MESSAGES=5000 with explicit 413 on overflow instead of silently omitting older messages. Original access code remains out of PDF/Print, and text private ticket URLs are redacted. Only authenticated ticket viewers can open exported content; no public PDF bypass.

## Real test evidence
- Existing owner-controlled UAT tickets #116 (Light Remote, 1e2f01e5-9742-4bfa-85d0-ea327505eb9a) and #117 (LightBI, dee62057-1187-4085-bd68-cbb5964979d9) both verify ticket code HTTP303 then render HTML HTTP200. Without cookie GET Print/PDF -> HTTP403 for both.
- Authorized Print page HTTP200 with original brand, complete filtered transcript and a Print now button; no reply form.
- Authorized PDF HTTP200 Content-Disposition attachment, actual %PDF bytes (~15KB Remote, ~32KB BI); original logos. One code+link email/ticket behavior unchanged.
- Automated acknowledgment removed from both public timelines, genuine customer messages retained. After deployment a real UAT #116 web reply POST with signed HMAC form returned HTTP303 and the reply appeared after reload.
- Source unit tests 67/67 PASS, including 40-message pagination simulated and 50-message multi-page PDF; production npm audit 0 vulnerabilities.
- Gate /ai-support/healthz, LibreDesk /, Gold /support HTTP200, CSS/print JS HTTP200. Gate and LibreDesk services active.
- Owner Chrome visual acceptance with manual interaction still pending; HTTP/PDF and reply UAT are confirmed.

## Rollback
Before the migration the known-good Gate image was tagged libredesk-support-gold-gate:pre-ticket-ui-v2-20261027, SHA256 46e123f838f3b0f4ebd01f7b219b732f96b2568903e31d6a1f87ebe8ea6e72b8. Compose override stored at /home/ubuntu/services/libredesk-support/runtime/gate-rollback-ticket-ui-v2-20261027.yaml. Roll back Gate using canonical runtime Compose plus this override with up -d --no-deps --no-build gate. Do not accidentally reenable disabled native LibreDesk automation Rule 1: Gate remains sole outgoing acknowledgment sender. New Gate metadata table may remain harmlessly after rollback. No database deletion or native Libredesk app restart required.
