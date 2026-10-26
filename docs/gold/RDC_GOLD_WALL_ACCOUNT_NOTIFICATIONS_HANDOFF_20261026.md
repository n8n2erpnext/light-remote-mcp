# Gold Local Wall — account notification bell UAT handoff (26 October 2026)

## Owner scope and protected baseline
- Requested: deliver the EXISTING Gold Notification Center notifications to every enrolled customer's Local Wall as a bell with unread count, last five previews, and a click to the SAME notification in Gold `/account/inbox`.
- Develop on a separate Gold feature branch `feature/gold-wall-account-notifications-20261026`, based strictly on known-good source `371f1ce786fa484b86a77a7272ce16e6591e2a99`. Do NOT merge into Gold rebuild/main and do NOT touch Windows builds or production.
- The live `light-remote-gold-uat` four-service stack is still on the good source commit. There is one historical Windows orphan claim. Its strict cutover gate has not been bypassed, and the existing Gold stack has not been restarted.

## Implementation
- `operator-host/executor-routes-device-channel.mjs`: read-only `POST /v1/device-channel/account-notifications`, verified enrollment-signed context; sender cannot specify account. Account must be operational. Reads canonical PostgreSQL-backed `accountNotifications.inbox(accountId, account)` + `proTeams.inbox({memberAccountId:accountId})`, returns 5 newest previews and canonical unread count, strips URLs, invite codes and other internal fields.
- `plugin-server/device-public.mjs`: allowlists `account-notifications` in existing rate-limited signed channel proxy.
- `device-agent/operator-agent.mjs`: new signed-channel client, account-bound, passes read-only `getAccountNotifications` callback to daemon Wall and wall-only companion. Produces a Gold account Inbox URL using configured server origin; does not transfer a login token.
- `device-agent/local-wall.mjs`: authenticated `GET /api/account-notifications`; 401 unauthenticated, 503 fail-closed if upstream unavailable. Inserts the bell into the shared home/memory/Codex header for all OSes where Local Wall is available.
- `device-agent/wall-account-notifications.mjs`: local Material bell icon, count badge, 5 previews, 60-second visible-tab refresh and View All. Secure DOM `textContent`, bounded fields, same-origin local fetch, no cookie/credentials forwarded to website; opens `/account/inbox?notificationId=<id>` in a new tab.
- `plugin-server/account-portal/inbox.html`: validates the deep-link ID, highlights/focuses/scrolls to that notice after authenticated page load. Reading remains under existing account UX: opening the external link does not secretly mark read.

## Tests already PASS
- New `deploy/scripts/selftest-gold-wall-account-notifications.mjs`: account scoping, signed route, disabled-account rejection, Pro Team preview scrubbing, 401 when unauthenticated, 503 fail-closed, icon/UI JS parse and link contract.
- Regression: Gold Wall navigation, Local Wall account auth, client account-login bootstrap, static Node checks, and `git diff --check`.
- Gold UAT source candidate was staged with exact SHA-256; an isolated synthetic notification canary `light-remote-gold-notification-canary.service` is ACTIVE on **127.0.0.1:5593 inside LXD only**. Uses Gold's existing Local Wall cookie validator but does not request customer data or modify DB. Non-authenticated request returns 401; authenticated fixture request returns unread=1 and the Gold account inbox URL; Wall HTML renders bell/panel.
- The canary is an isolated synthetic **UI acceptance**, NOT a completed live signed-channel integration or full four-service cutover. No Windows build.

## Next release gate
- Keep the feature branch isolated until a legitimate UAT cutover is possible. Original release gate requires the historical orphan claim to be resolved with authorized/audited owner recovery (or a genuine signed ACK), and Fleet sessions to be idle. Do not use direct SQL DELETE/UPDATE or force-close unrelated sessions.
- When the gate becomes green, promote the exact source candidate to Operator, Plugin and Wall *together*, test with a genuine account notification published in Gold, verify unread changes across Wall and Account, and run Windows build only after the owner approves.
- Avoid replacing good Wall source `371f1ce` before release gate passes.
