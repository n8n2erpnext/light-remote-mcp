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
