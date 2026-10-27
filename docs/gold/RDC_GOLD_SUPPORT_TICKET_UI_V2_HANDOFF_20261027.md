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
## 2026-10-27 Gold Support Ticket UI V2 — direct Print and branded footer LIVE

Scope: Owner requested Print ready to open the system/browser print dialog without navigation to a new URL; toolbar to match preview (Print ready, Ticket details, Export PDF); Open/Snoozed/Resolved/Closed should be clickable colored informational tags; add website, correct support email, print/export time and page count to every printed sheet and PDF page.

Changes:
- support-gate/src/public-ticket.mjs: brandFor includes original brand-specific email (Remote support@thaiduy.digital; LightBI support@lightbi.app); outputTimestamp UTC+7 ICT; print ready is a button with authenticated /print data path, Ticket details jump anchor, Export PDF link; status tags link to disclosure defining meanings and do not mutate statuses; full transcript Print HTML includes footer showing https://support.thaiduy.digital/, brand email, Printed: local ICT time. HTML CSP external same-origin JS, self-framed print. PDF and print still reject missing signed ticket access-cookie.
- support-gate/public/ticket-actions.js (new): Print ready fetches full authenticated print HTML and prints it inside a same-origin about:blank hidden iframe via window.print, so browser stays on original ticket and browser print URL does not contain the secret ticket UUID. No auto navigate/new tab. Exact-origin CSS and images loaded before print; iframe removed on afterprint. Status tag clicks open help details.
- support-gate/public/ticket.css: four accessible semantic colors (Open blue, Snoozed amber, Resolved green, Closed muted red); current status outlined, no status-changing controls. A4 print with 25mm bottom margin, repeated fixed footer and CSS @page bottom-right counter(page) / counter(pages).
- support-gate/src/ticket-pdf.mjs: PDFKit each page has divider, clickable support site, brand-specific mailto, Exported: local ICT time, Page N / TOTAL. Bottom page margin reserved to prevent overlap; original PNG brand logos preserved.
- support-gate/src/server.mjs: exposes external static ticket-actions.js; no anonymous access changes. Test support-gate/test/ticket-print-footer.test.mjs added.

Verification: 70/70 Support Gate tests passed, JS syntax check and git diff --check PASS. Real HTTPS verified owner-controlled #116 Light Remote and #117 LightBI: correct code HTTP303, ticket/print/PDF HTTP200 with cookie, PDF binary begins %PDF, no-cookie print/PDF both HTTP403; each print document contains website, correct brand support email and printed ICT time. HTTP markup has status tags, details and print button; no new-tab print link. Multi-page PDF visual UAT: 65-message LightBI fixture rendered with Ghostscript as seven PNG pages; first and last visually inspected and clean with website/email/ICT timestamp and Page 1 / 7 through Page 7 / 7. Browser native print click on user Chrome not remotely observed: manual UX confirmation remains. Existing mail sending, one-email link+code, agent, Light Remote production, Libredesk core and AI Auto-send OFF unaffected.

Rollback: pre-update verified image libredesk-support-gold-gate:pre-footer-print-status-20261027, image sha256 cfce7611ea19241ba73c57a8b079d2a90bed0eff3357afec9b9125c471b8b253; override /home/ubuntu/services/libredesk-support/runtime/gate-rollback-footer-status-print-20261027.yaml. From runtime folder, run docker compose -f compose.yaml -f gate-rollback-footer-status-print-20261027.yaml up -d --no-deps --no-build gate. Only Gate rebuilt/recreated. No database migrations.
## 2026-10-27 — Fix Print ready, eight-cell ticket code, offline Material Icons (Gold UAT)

Owner Chrome screenshot showed Print ready alert `Unable to prepare the full ticket for printing. Please retry.`, and access code as one field prone to pasted punctuation. User requested Google Material Icons (fonts.google.com/icons) but WITHOUT runtime Google dependency, plus Send button icon.

Fixed:
- `support-gate/public/ticket-actions.js`: removed race-prone document.open/write and CSS link load promise that could stall or fail; now authenticated fetches the protected full `/print` document, loads it into same-origin hidden iframe via `iframe.srcdoc`, waits for real iframe `load`, fonts and images, calls frame.contentWindow.print() without changing main ticket URL. Status errors appear inline instead of blocking alert. Requires owner Chrome actual native dialog confirmation; no claim of remote browser click.
- `support-gate/src/ticket-access.mjs`: retains server-only HMAC code, signed cookie and old fallback form. Page loads local `ticket-code.js` and self-hosted Material Icons stylesheet, CSP script-src/font-src self. `support-gate/public/ticket-code.js`: enhances code input into eight single-character inputs, automatic focus/Backspace, arrows, full-code paste with dash/spaces/dots removed, uppercase normalization, prevents incomplete submissions, passes one canonical `code` hidden input to unchanged POST verifier. Works with JavaScript off via original single input fallback. Material icon added to Open ticket and Resend ticket email buttons.
- `support-gate/src/public-ticket.mjs`: Print ready / Ticket details / Export PDF buttons and Send reply use original Material Icons ligatures rather than text glyphs; local icon CSS, same-origin `font-src self` in ticket CSP. `support-gate/src/server.mjs`: static allowlist for `/ticket-code.js`, `/material-icons.css`, `/fonts/material-icons-latin-400-normal.woff2` with correct WOFF2 MIME.
- `support-gate/public/material-icons.css` and `support-gate/public/fonts/material-icons-latin-400-normal.woff2`: fontsource material-icons 5.3.0, local font 128352 bytes, separate license saved in `public/fonts/OFL-material-icons.txt`; zero Google network calls.
- `support-gate/test/ticket-ux-fixes.test.mjs`: regression tests for offline font, icons, enhanced code markup, print iframe srcdoc load and no legacy doc.write alert.

Acceptance:
- 73/73 repository tests PASS; JS checks and git diff --check PASS.
- Separate jsdom 27 UAT (isolated /tmp, not runtime dependency): eight inputs created; paste `CCBA-3WGM.` -> `CCBA3WGM`; Backspace moves/clears; incomplete form blocked; submitted code canonical. No codes exposed in user-visible handoff.
- Real Gold live ticket #116 Remote and #117 LightBI: no-cookie access gated, correct server-derived 8-character verifier HTTP303, authenticated ticket 200, print 200 and PDF 200 returning `%PDF-`, no-cookie print HTTP403, correct brand print footer, local Material stylesheet and Send icon. Static JS/CSS/WOFF2 assets all HTTPS200; WOFF2 type font/woff2 and no fonts.googleapis.com. Gold, Gate and Libredesk health HTTPS200.
- Only Gate Docker container rebuilt; native Libredesk core, one-email link+code, email sender, ERPNext, production, logos, AI Auto-send OFF untouched.

Rollback:
- Pre-fix Gate image tag `libredesk-support-gold-gate:pre-otp-print-icons-fix-20261027`, digest sha256:74cc49479953fc621b41cd1d840404928f645198d465a066104d83c4135ad066.
- Roll back via runtime override (see `/home/ubuntu/services/libredesk-support/runtime/gate-rollback-otp-print-icons-fix-20261027.yaml`), no DB migration or data loss.
