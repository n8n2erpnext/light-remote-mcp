# READ FIRST — Libredesk + AI Support Gate, VPS-ARM (2026-10-27)
## Canonical source of truth
Private MASTER handoff: `docs/gold/RDC_GOLD_LIBREDESK_SUPPORT_GATE_MASTER_HANDOFF_20261027.md` (runtime file; ignored by Git, do not force-add).
Working branch: `feature/gold-wall-account-notifications-20261026`.
One canonical origin: `https://support.thaiduy.digital/` (Libredesk) and `https://support.thaiduy.digital/ai-support/` (Gate) through existing NetBird Traefik. ERPNext/Helpdesk LXD and Gold Wall 5591 untouched.
No separate Gate admin: owner auth uses valid Libredesk Admin session.

## Verified Zoho Light Remote support mail (27 Oct)
- **Light Remote** = Zoho `support@thaiduy.digital` (not Lark).
- Libredesk native **Inbox ID 1**, email enabled, IMAP `imap.zoho.com:993 SSL`, SMTP `smtp.zoho.com:465 SSL`.
- Controlled real email test imported into **conversation ID 4**, message 4 incoming/received (~09:51 ICT), message 5 outgoing/sent (~09:52 ICT). 4 conversations from initial IMAP scan. Both send and receive manually demonstrated by Owner's screenshots. Exact external mailbox delivery of response not separately audited from server.
- Native Libredesk webhook active; Gate ingested signed metadata-only events: 4 conversation.created, 5 message.created, 2 webhook.test at earlier acceptance; live logs show HTTP 202.
- One harmless-ish template fallback log `error fetching default outgoing email template` while message nonetheless recorded sent. Do not silently alter native templates.
- **LightBI** Lark = domain configured only, mailbox/address not yet finalized, no inbox 2.

## New phase: Gate Load ticket (current session)
- Source: `support-gate/src/ticket-read.mjs` helper + `src/server.mjs` protected `GET /api/tickets/:uuid` + `public/app.js`/HTML/CSS button.
- Runtime only `/home/ubuntu/services/libredesk-support/runtime/.gate.env`: `LIBREDESK_REMOTE_INBOX_ID=1` appended. **Do not print secrets** from other keys.
- An authenticated Libredesk Admin session can read a native conversation and a bounded recent public message history, only if `inbox_id===1` and `inbox_channel==='email'`; private notes are excluded. Extracts contact email, subject, latest message UUID. Does not modify native Libredesk or trigger send. UI provides Load ticket from UUID and directly from event queue, fills owner draft form. Worker draft-only token CANNOT use this owner read endpoint.
- Gate automated send remains **OFF**: no dedicated agent API keys and no LightBI inbox ID, `outbound_ready=false`. Never auto-send or use admin key for background workers.
- Tests: `npm test` **14/14 PASS**, node --check pass, git diff --check pass. Gate-only Docker rebuild; public HTTPS /healthz 200, unauthenticated ticket API 401 and /app.js includes Load ticket control.
- **Acceptance still pending:** cannot claim live *authenticated* Load ticket end-to-end: Gold desktop plugin requires fresh official A/B pairing. Ask Owner to open Gate and click Load ticket on controlled sample, or reconnect approved Gold session, then validate real result and saved draft, no send.
- Rollback: private checkpoint `/home/ubuntu/n8n2erpnext/support-gate-checkpoints/20261027-ticket-read/gate.env.pre-ticket-read`. Rebuild/recreate **only gate** from corresponding previous Git commit and restore previous env if necessary. Never `docker compose down -v`.

## Next
1. Complete authenticated owner UI Load ticket acceptance using known test conversation UUID and ensure no private notes included.
2. Design dedicated least-privilege Libredesk API identity for autonomous AI research via official Light Remote, without exposing owner credentials, and draft-only worker. Continue to require Owner review and explicit send authorization.
3. Map Lark mailbox only after Owner provisions/approves it; human-approved outbound Gate cannot be enabled until both brand mappings and per-conversation freshness checks verified.
No production Light Remote edits, Windows builds, NetBird/Traefik changes or Git merge.
