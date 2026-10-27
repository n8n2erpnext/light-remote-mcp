# Light Remote Support — outgoing email wrapper

Canonical editable source: `mail-templates/light-remote-outgoing.html`.
Installed through native **Libredesk Admin → Notifications → Templates → Outgoing email templates**, entry **ID 9**:
`Light Remote Support — Branded Outgoing Email` (Default=true).

- Zoho sender remains in Libredesk Inbox ID 1, `support@thaiduy.digital`. This template contains no mail credentials and changes no SMTP/IMAP configuration.
- Native Go `text/template` placeholder `{{ template "content" . }}` **must appear exactly once**. Native LibreDesk validates it on Save.
- Markup uses a light email-client-safe 600px table wrapper, dark-blue brand bar, typographic LR mark (no tracking/external image), gold accent, reply instruction and Thai Duy Digital footer.
- It **does not** insert fixed salutations or sign-offs, preventing double signatures when AI or an agent writes those in the message.
- The checked database body is the minified version of this file (line-break/indent whitespace removed). The live database comparison on 2026-10-27 passed: exact match, 3519 chars, SHA256 `78c2b39eafd37e59b022240563d2bfda554342408fd7b92025fc4a988cc397f4`.
- Changes to this default outgoing template apply to **future outgoing Libredesk emails**, not existing messages or automatic ticket acknowledgement.
- **Important:** Libredesk 2.9.0 supports one global Default outgoing template, not per-inbox email wrappers. When LightBI Lark inbox is added, implement brand-aware wrapping before any LightBI outgoing emails; otherwise they would get Light Remote branding.
- Rollback (native UI): open `https://support.thaiduy.digital/admin/templates/9/edit`, uncheck **Is default**, Save. This restores Libredesk's stock unbranded fallback when no other default exists. Do not delete inbox data/volumes.
- No customer mail was sent for template acceptance. Only Admin UI, native template validation, stored-content checks and service health were verified.

## Current active multibrand default — 27 October 2026

The former Light Remote-only source is superseded by `support-multibrand-outgoing.html`. Libredesk global default template **ID 9** now has conditional Go template branching on `.Inbox.Name`: `Light Remote Support` → LR brand and `support@thaiduy.digital`; `LightBI Support` → BI brand and `support@lightbi.app`. Required `{{ template "content" . }}` occurs exactly once. Native Libredesk Admin Save validated the template; after fixing HTML delimiters, **real Lark SMTP → Zoho email displayed full BI header and footer**. Be careful not to mistake a global default for a per-inbox DB template. If third brands are added, update the branch conditions and test both incoming and outgoing. No automated send.

## Official Light Remote SVG mark in outgoing emails — 27 Oct 2026

The current native Libredesk globally-default email template **ID 9** is `support-multibrand-outgoing.html`. Its **Light Remote** header now uses the real official mark supplied by the owner from
`https://raw.githubusercontent.com/n8n2erpnext/light-remote-mcp/refs/heads/main/assets/branding/light-remote-mark.svg`.
Source copy: `support-gate/assets/branding/light-remote-mark.svg` SHA256 `417f45d22d27c82ba7159b94e6e59bc93da64546a5027ed06aaeb54a9cee1d65`.

For compatibility with Gmail/Outlook where remote SVG logos are often unsupported, a 160×160 transparent PNG was rasterized via ImageMagick and served from the Gate's public static allowlist:
`https://support.thaiduy.digital/ai-support/branding/light-remote-mark.png`.
Production PNG `public/branding/light-remote-mark.png` SHA256 `647a6eeaca0f10eac5303239e38e2969f88c4a2fb8cab1662c74adfc7adcc1e0`. GET is unauthenticated with `Content-Type: image/png` and 1h cache. No new proxy or DNS. The email markup adds `<img src=... alt="Light Remote">...` **only** when `.Inbox.Name` is not `LightBI Support`; the BI initials, footer and Lark sender for LightBI remain unchanged. Global `{{ template "content" . }}` remains exactly once.

Native Libredesk Admin editor saved successfully as Default ID 9 via authorized Gold Windows session. The template stored in PostgreSQL is an **exact match** to whitespace-minified source, 3970 characters, one hosted PNG image and one content template placeholder. Gate/Libredesk/ERPNext HTTP health 200. Live email UAT from **Light Remote ticket #106** to owner-controlled Gmail `th.dangduy@gmail.com`: Gmail received the response at 2026-10-27T06:24:08Z. Raw Gmail MIME, after quoted-printable decoding, includes the complete public PNG HTTPS URL in an `<img>` tag and correct Light Remote brand name. No external customer was mailed. Some email clients block remote images until user chooses to display them; alt text remains available.

Rollback: in Libredesk native Admin Templates ID 9, restore the prior `support-multibrand-outgoing.html` from Git parent and Save; for Gate-only asset route revert the code/ Docker image tag `libredesk-support-gold-gate:pre-official-mail-logo-20261027`. Do not alter DB volumes, NetBird routes, customer tickets or mail credentials.
