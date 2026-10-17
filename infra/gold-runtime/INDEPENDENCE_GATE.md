# Gold independent-runtime acceptance gate

**Acceptance definition**: if the old production LXD `light-remote-direct` is stopped, the new instance retains its OWN validated Operator, Plugin, Client release metadata, Web V4, persistent business state, Team, Inbox, Notification, billing and registration, and passes end-to-end device A/B. Do not stop production to test before this contract has passed using an independent isolated system.

## Independent no-production smoke checks — PASS (NOT A PG RELEASE)

- Installed lockfile-pinned dependencies into the **Gold worktree only**, not the production LXD. Node modules are excluded from Git.
- The focused `deploy/scripts/selftest-gold-operator-http-isolated.mjs` launches a fresh Operator bound to its own private Unix socket, isolated home/log/state directory and synthetic account. Verified `/healthz`, `/v1/admin/accounts`, `/v1/admin/notifications` and expected 404. No production credentials or data are loaded; ephemeral files are removed after the check.
- The focused `deploy/scripts/selftest-gold-plugin-http-isolated.mjs` launches Plugin on its own loopback port with synthetic OAuth secret and all state/config/output paths inside a private temp directory, no Paddle live checkout or production socket. Verified `/healthz`, Home V4, embedded full `/ai-guide`, Markdown, `llms.txt` and MCP GET 405. This test exposed a missing `lib/light-remote-plan-offers.mjs`, which was restored from the vetted Team source; the test then passed.
- These tests independently prove **each process can start and serve basic endpoints without touching production**. They do NOT prove the two processes have been paired into a complete stack, or that any durable business write goes to PostgreSQL; Team A/B/client end-to-end and production-off operation remain unaccepted.

## Current status — NOT READY

- Source code: V4/R4 deployed backend code preserved, Team/Inbox/Notification/AI Guide source integrated in candidate. Focused tests PASS but this is NOT a full standalone service acceptance.
- Operator: Team and account notification source registry dependencies connected to account routes. They remain legacy JSON repositories until PostgreSQL adapters are completed.
- Plugin: no validated stand-alone process on its own port/socket yet. All test credentials and OAuth domains must be isolated, no live Paddle/email webhooks.
- Database: 17 SQL migrations checksum pass (001..013 RC50 unchanged; Gold 014 announcements, 015 analytics, 016 support outbox and 017 relational Core); isolated PostgreSQL 17/Redis 8 Compose prepared, but Docker startup was denied by the local target's effective capability, so neither service is running.
- Windows rc48 / macOS rc49 real source compatibility is unaccepted because a client replacement attempt was policy-denied previously. Never bypass using a different tool or machine.
- Do not call a non-production JSON-mode startup proof of PG-only independent acceptance.
- Existing production remains active and must not be shut down, restarted, reconfigured or used as a new process's data source.

## Separate-instance path contract

To run a local isolated DEV smoke, set `LIGHT_REMOTE_GOLD_INDEPENDENT=1` with:
- `LIGHT_REMOTE_GOLD_ROOT`: absolute directory owned by this instance
- `OPERATOR_SOCKET`, `OPERATOR_STATE_DIR`, `OPERATOR_LOG_DIR`, `OPERATOR_KEY_FILE` inside that root
- All Plugin OAuth, account recovery, Paddle, analytics, announcements, support outbox, Google OAuth, backoffice and distribution paths inside that same root
- Explicit `LIGHT_REMOTE_PLUGIN_ORIGIN=http://127.0.0.1:<unused-port>`, `LIGHT_REMOTE_PLUGIN_HOST=127.0.0.1`, `LIGHT_REMOTE_PLUGIN_ALLOW_HTTP_LOOPBACK=1` **for private DEV only**
- Separate `OPERATOR_TEAM_OAUTH_VERIFY_KEY_FILE` (Ed25519 public) and `OPERATOR_TEAM_INVITE_SECRET_FILE` (32-byte private secret). Neither is the Operator X25519 transport key.
- No live OAuth or Paddle accounts; no production SMTP, domain, webhook or database shared. Never publish a loopback DEV origin as the production OAuth issuer.

`lib/gold-runtime-isolation.mjs` rejects production-path/socket/host references when the independent flag is set. This guard does **not** establish PostgreSQL persistence or process readiness.

## Minimum acceptance sequence

1. Obtain legitimate target Docker capability for private PG17/Redis8 deployment (do not bypass existing denial), create credential/roles externally, run migrations, prove locked roles and DB/Redis actual connections.
2. Finish the durable PG adapters for all Operator/Plugin business state; legacy JSON cannot remain an alternate writer. Prove restart consistency, enforced revocation, OAuth replay protection and transactional billing/notification outbox.
3. Reconcile latest authorized Windows rc48/macOS rc49 client code and their native helpers; compile and test platform artifacts, version compatibility and A/B.
4. Start a separate isolated Operator and Plugin bound exclusively to the new socket and loopback host, independently verify Register/Login, Device enrollment, Local Wall A/B, Pro Team seats/member binding, Inbox, admin Notification, AI Guide, Paddle sandbox disabled in LIVE, support outbox and Downloads V4.
5. Run a cold restore rehearsal using disposable, independently owned test data; validate that the destination runs when its original source is offline. Do **not** use production data or stop production without a separate cutover window.
6. Only after every gate passes, create immutable Gold artifact and owner-approved rollout.

All existing P0 WriterEpoch/HA experiments remain frozen historical reference; cold migration with owner-approved downtime is sufficient.
