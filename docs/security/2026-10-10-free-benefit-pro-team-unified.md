# Light Remote: Unified Free Anti-Abuse + Pro Team Entitlement — 2026-10-10

Status: SOURCE CANDIDATE, NOT PRODUCTION-ENABLED.
Origin research: /home/ubuntu/handoffs/LIGHT_REMOTE_FREE_MULTI_ACCOUNT_ABUSE_RESEARCH_2026-10-10.md
Parent source: feature/pro-team-concurrency-20261010 (6f69a40).
Branch: feature/free-benefit-pro-team-20261010.
Only A/B 24h and orphan enqueue cleanup were already deployed to the Direct Hub; these new Free/Team changes have NOT been deployed.

## Agreed product policy
FREE:
- 10,000 billable tool calls / UTC calendar month per account.
- Also 10,000 billable tool calls / UTC month across ALL Free accounts using the SAME logical device installation/family. Both ceilings apply.
- Free has no shared team/guest device entitlement and at most 1 worker per device.
- A used 9,500 on installation X -> account B relinks to X -> B has a maximum additional 500 Free calls on X that month. C/D cannot mint more Free calls on X.
- History is not reset by logout, owner Relink, normal update, restarting Wall or switching ChatGPT conversations.

PRO/VIP:
- Paid owner may create a team with at most 5 seats INCLUDING the owner. Invitees can be accounts whose personal plan is Free; their team activity is billed to the paying owner, not their personal 10k Free allowance. Team membership alone cannot convert personal Free devices into Pro.
- Concurrent execution cap is 3 actual workers PER SHARED DEVICE (across all seats and agents), not 3 per member; up to 5 seats does not imply 15 concurrent device workers.
- Access requires active paid owner plan, explicit owner device share, accepted one-time invitation, verified membership, separate local A/B approval bound to the acting OAuth client/agent, and unchanged device-local final permissions.
- Downgrade/expired plan: team access stops; owner personal Free usage reverts to remaining Free allowance without erasing historical Free consumption. Member revocation must immediately block new jobs.
- Keep the existing Lead/Worker role architecture as a separate scheduling layer; no automatic self-execution by workers without valid authorization.

## Source implementation
New operator-host/free-benefit-registry.mjs:
- persisted device-family per-month counter and idempotent synchronous reservation, cross-account historical usage bootstrap from UsageRegistry monthly per-device counters;
- feature mode defaults to SHADOW, emits 'free_benefit_shadow_would_block' telemetry on violations, and can be separately configured to ENFORCE after full UAT;
- explicit signed-proof callback required for key-rotation family linkage; no use of raw MAC/serial/IP address as definitive identity;
- monthly reset in UTC, 429 free_device_allowance_exhausted on enforcement, stable across restart;
- in one Operator Node process, synchronous reserve prevents two simultaneous tool calls both passing at 9,999 (multi-process needs transactional external DB).

operator-host/session-manager.mjs:
- beforeRecord callback at *both* record(toolCalls) and touch() paths, so exec/files/process/SCP/terminal and read/live routes cannot bypass metering.
- double-accounting from real-remote live read fixed in executor-routes-runtime.mjs.
- exec operation dedupe now runs BEFORE charging a tool call.

operator-host/executor.mjs:
- default shadow registry wired into usage/session event pipeline; paid Pro/VIP exempts Free-benefit pool; separate ProTeamRegistry initialized with actual account entitlement and status.
- shadow audit events and persistent Free ledger file are separate from existing usage.json, preserving existing production accounting.

operator-host/team-entitlement-policy.mjs:
- shared team billing resolves to owner account only after ProTeamRegistry authorization, explicit owner device share, and verified per-client A/B; Free owner cross-account access denied.
- NOT yet invoked by real plugin/device routes; never treat tests as permission to bypass accountId isolation.

Existing operator-host/pro-team-registry.mjs:
- Pro/VIP only, owner included in 5-seat maximum, account-bound 15min single-use invites, owner-controlled sharing and revocation, fail-closed on plan downgrade.

## Verification
PASS: selftest-free-benefit-pro-team; selftest-pro-team-seats; v09 usage registry; v11 usage renewal accounting; v09 account registry; v10 account routing isolation; v10 multi-account device channel; v10 plugin account scoped lifecycle; v08 fleet execution.
Specific acceptance PASS: A=9500 B/C/D cannot exceed family 10000, month UTC rollover, key rotation with valid proof retains usage, invalid proof rejected, concurrent 9999 reservation allows one, restart persistence, Pro bypass/downgrade, same operation idempotency, real remote live no duplicate billing, owner paid team billing with A/B and seat count.
Full repo suite not certified.

## IMPORTANT limitations before production
1. Key-derived deviceId is not a tamperproof physical-device ID. Current source can group a verified same-key Relink; **brand-new key after full wipe** will look like a new installation until clients retain a protected installation principal or old key signs a rotation. Add durable principal for macOS Keychain, Windows DPAPI, Linux root-owned protected storage, and a manual owner transfer/recovery procedure. Verify server-side cryptographic proof; never allow arbitrary client-claimed family mapping.
2. ProTeamRegistry is currently a model/registry only. Multi-account team command routing, OAuth account/member identity, locally approved A/B for each client, per-team billing, device owner sharing API, UI and business downgrade hooks are not yet end-to-end wired. Do not expose cross-account access by deleting account checks.
3. Shadow mode needs live data observations, false-positive handling (families, second-hand devices, shared households), retention/privacy review and admin override before enabling ENFORCE.
4. Per-process sync reservation is NOT a distributed database transaction. If Hub scales to multiple Operator workers, use transactional atomic counter and idempotent reservation in PostgreSQL or equivalent before enforcing.
5. Add 429 response UX with used, limit, resetAt, upgrade/appeal; email verification and signup rate limiting remain layers, not sole defenses.
6. Existing client versions not altered. No prod restart or Free account hard blocking in this branch.

## Rollout stages
S1: Merge reviewed source into suitable server release with SHADOW only; monitor family/grouping and no telemetry/account regression.
S2: Synthetic + live owner-authorized A/B account Relink (A/B), key rotation and concurrency. Migrate historical usage. Check forced unlink and ownership transfer.
S3: Pro Team trusted routes, invite/accept/seat endpoints, bill-to-owner accounting and independent per-client A/B; E2E two paid team users and three concurrent different jobs on single device; downgrade/revoke tests.
S4: Persist protected installation principal to each client OS; publish privacy notice/recovery UI; gradual Free enforce canary behind feature flag, with immediate rollback.
S5: Full automated regression + production monitor; only then enable hard enforcement.

No modifications to active LXD Direct production made during this Free/Team work.
