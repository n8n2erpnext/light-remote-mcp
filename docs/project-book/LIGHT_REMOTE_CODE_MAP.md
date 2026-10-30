# Light Remote Code Map — Gold P2 Baseline

Status: verified-source-map (as of Gold SHA 47556b829425784e4c1240c88f08e7272970595f)
Date: 2026-10-30
Scope: production-facing source ownership, admission/grants, native effects and release evidence
Supersedes: none
Primary sources: [Project Book](LIGHT_REMOTE_PROJECT_BOOK.md), [Git P2 plan](../gold/GOLD_P2_INTEGRATED_ABV2_NICKNAME_PRO_SHARE_PLAN_20261030.md)

This is a **map of source code**, not a proof the same source is currently running in Gold UAT or rc47. Always check process runtime SHA, module provenance and deployed migration first.

## 1. Entry and trust topology

```text
MCP Client (ChatGPT/Claude/etc)
     │ authenticated account OAuth + tool scopes
     ▼
plugin-server/tools.mjs — helper and tools
plugin-server/operator-adapter.mjs — authorized Operator requests
     │  account auth alone is NOT device control
     ▼
operator-host/executor.mjs — Operator authority, service composition
     ├─ executor-routes-account.mjs — account/team/invites and owner portal APIs
     ├─ executor-routes-plugin.mjs — plugin-facing routes
     ├─ executor-routes-device-channel.mjs — device enrollment, A/B, heartbeat,
     │   signed channel, working session creation and terminal receipt path
     └─ executor-routes-runtime.mjs — runtime routes
         │ verified device channel + grant + policy + session/worker locks
         ▼
device-agent/operator-agent.mjs — enrolled Agent
device-agent/local-wall.mjs — local consent /approve, Wall UI
device-agent/fleet-wall-runtime.mjs — Fleet UI, status and jobs
device-agent/execution-epoch-journal.mjs — durable local execution evidence
     │
     ▼
OS process / Files / PTY / RM V2, subject to effective device policies
```

An MCP login provides account identity only. Device operations require device enrollment identity and a separate authenticated A/B grant, device policy, active session and execution authority. Never route based solely on visible Short ID or nickname.

## 2. A/B V1 source owners vs V2 NOT YET IMPLEMENTED
- [Legacy pair registry](../../operator-host/device-pairing-registry.mjs) — 4+4 rotating A, currentByDevice, redeem.
- [Grant registry](../../operator-host/device-access-grant-registry.mjs) — B approval, 24h absolute grant bound to account/Agent/device/connection.
- [EnrollmentRegistry](../../operator-host/enrollment-registry.mjs) — device key binding and signed channel replay protections, not the new target resolver.
- [Helper tool](../../plugin-server/tools.mjs) — currently receives legacy aCode; does not have shipped V2 targetQuery.
- [Operator adapter](../../plugin-server/operator-adapter.mjs) — legacy pairBegin/recover; current onboarding still instructs copying A from Wall.
- [Device channel routes](../../operator-host/executor-routes-device-channel.mjs) — device pairing begin, pending grants, owner approval and working-context source routes.
- [Local Wall](../../device-agent/local-wall.mjs) — legacy A and B entry; /account V2 B approval not currently accepted.
- [V2 Product Contract](../gold/GOLD_P2_INTEGRATED_ABV2_NICKNAME_PRO_SHARE_PLAN_20261030.md) — design only: stable Short ID6 visible on idle Wall; A suffix5 on Agent request, independent B, account-scoped discovery, exact pending correlation and old-client compatibility.

## 3. Durable session and nickname
- [Session Registry](../../operator-host/session-manager.mjs) — open, hold, resume, display `label`; immutable sessionId.
- [Redis session persistence](../../lib/gold-session-redis.mjs) — registry snapshots/mutator whitelist; new rename setter must participate in durable writes.
- [Operator device channel working-context route](../../operator-host/executor-routes-device-channel.mjs) and [plugin adapter](../../plugin-server/operator-adapter.mjs) — currently hardcode `ChatGPT Light Remote` in session open path. A helper label alone does not yet create a durable Agent-selected name.
- [Naming specification](../gold/GOLD_P2_INTEGRATED_ABV2_NICKNAME_PRO_SHARE_PLAN_20261030.md) — first Agent-picked name, non-blocking, owner override; not shipped.

## 4. Team → Pro Share
- [Pro Team registry](../../operator-host/pro-team-registry.mjs) — five-seat internal source and invitations/device sharing; preserve.
- [Team authorization](../../operator-host/team-member-auth.mjs) and [Team Dispatch Authority](../../operator-host/team-dispatch-authority.mjs) — guest identity and preview scopes; do not equate preview to live remote execution.
- [Native Pro Team PG](../../lib/gold-native-pro-team.mjs) — persistent team representation.
- [Operator](../../operator-host/executor.mjs) has `teamSessions=null` and [account routes](../../operator-host/executor-routes-account.mjs) expose `crossAccountExecutionEnabled:false` as inspected. Pro Share narrower owner+one guest execution has NOT been activated, metered or sold.
- The enterprise IT Support per-branch/per-group model is **future reference only**; do not create an enterprise entitlement/authorization engine in core P2.

## 5. P1/P2 GC, proof and release
- [Signed execution epochs](../../lib/gold-execution-epoch.mjs) — account/device/epoch authority and execution-start records.
- [Reconnect proof](../../lib/gold-reconnect-proof.mjs) — signed inventory, fenced uncertain side effects.
- [Agent durable journal](../../device-agent/execution-epoch-journal.mjs) and [terminal spool](../../lib/native-terminal-receipt-spool.mjs) — local durable evidence; local ACK is NOT a server ACK.
- [Device resource claims](../../lib/gold-device-resource-locks.mjs) — exact signed terminal receipt ACK transaction/fence release, preserving unknown/no-PID.
- [Verified channel fixture helper](../../lib/gold-verified-channel-context.mjs) — test fixture ONLY; not imported by production Operator `executor.mjs` at source audit.
- [SQL migrations](../../platform-v2/sql/migrations.lock.json) — version-locked manifest through 042; Gold UAT live still 039 at last observation.
- [PG epoch/GC harness](../../deploy/scripts/ci-gold-epoch-pg.mjs), [signed HTTP + enrollment fixture](../../deploy/scripts/selftest-gold-signed-http-duplex-pg.mjs), [Gold CI workflow](../../.github/workflows/gold-connection-lifecycle-gc.yml).
- Gold standalone CI 4/4 PASS on source SHA `d6892d7` is a fixture result. Subsequent docs-only commits do not mean another CI run succeeded.

## 6. Update rule
When code entrypoints, authority, persistence, major routes or trusted data flows change, update THIS map with the new exact source SHA and tests. Do not attempt to list every method in the repository; use targeted bookmarks and refer to actual source. When claims are not verified, mark as future or source hypothesis, not current runtime.
