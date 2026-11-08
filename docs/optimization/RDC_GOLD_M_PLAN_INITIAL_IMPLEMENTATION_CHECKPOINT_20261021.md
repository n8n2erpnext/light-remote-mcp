# Gold M Plan implementation checkpoint — first scoped session/entitlement slice (2026-10-21)

**Branch:** `feature/light-remote-gold-rebuild-20261018`.
**Scope:** review of [full Multi-Agent plan](./RDC_GOLD_MULTI_AGENT_JOB_SCHEDULER_MASTER_PLAN_20261021.md) and [owner-corrected Team allocation](./RDC_GOLD_MULTI_AGENT_PRO_TEAM_COMPATIBILITY_20261021.md); **first code slice**, NOT full M1–M6 completion.

## Logic review decisions

1. **Pro personal is one paying user with multiple authorized sessions**. Free target 2 retained sessions + 1 executing Agent, Pro/VIP target 12 retained sessions + 3 executing Agents, Team target 5 human seats including owner + 20 retained Team sessions (max 4/seat) + 5 executing Team Agents total (max 2/seat). Sessions, active Agent admission and OS worker quotas are **three independent dimensions**. Five Team Agent slots are an entitlement maximum, not permission to launch five heavy builds on a 2-vCPU server.
2. **Team calls belong to Team payer**: member's individual Free/Pro call quota and Agent slot MUST NOT be decremented by Team-scoped work. Trusted actor identity/member A/B remains distinct from Team owner/billed account. Existing owner Team add-on `monthlyMemberCallBudget=5_000` remains a distinct configured cap until billing decision. The Team preview's `maxWorkers=3` is an old process-capacity preview and is **not silently replaced with five OS workers**.
3. **No premature Team cross-account enablement**: existing `crossAccountExecutionEnabled=false`, Team signed OAuth/A-B/grant and owner billing remain separate. Team job admission M3-T requires its own live/UAT permission gate.
4. **Agent/node session ceiling compatibility**: current signed Agent `sessionCeiling=2` from older clients remains honored even on Pro. Raising account session cap to 12 does NOT overrule a device's authenticated local ceiling. To support Pro 3 Agents on one Windows, negotiate/build newer Agent with higher per-node capacity and verify owner-installed artifact. No installer change this slice.
5. **Legacy one-Agent/device session lane** remains intentionally reused, even with different open IDs, to preserve explicit existing contracts; 12 retained sessions across account does not mean 12 distinct sessions from one identical stable Agent on one device. The real ChatGPT multi-chat identity mapping must be validated before altering that lane or declaring product acceptance.
6. **Maintenance/recovery headroom:** client-update control sessions are NOT subject to the new ordinary account session cap, to avoid blocking an owner-triggered repair when Free/Pro's ordinary session retention is full. Existing global/node resource bounds still apply; dedicated reserved management admission is a later gate.
7. **Long curl/wget/build jobs are the primary usability problem**: physical Windows #464 curl via `exec` prevented concurrent `exec` and `process` with false drain, while curl via managed process permitted another `exec` during transfer. Keep signed busy pulse and build unified background job on **real device**, not Light SCP-specific workaround. M2/M5/M6 still to implement.

## Implemented in source (first slice only)

- New `operator-host/execution-capacity-policy.mjs`: immutable Free/Pro/VIP personal session+Agent target limits; Team target 5 seats / 20 sessions / 4 per seat / 5 Agent slots / 2 per seat; pure trusted owner/actor billing-context validation, cross-account fail-closed without a verified Team authority. **Not a live Team route.**
- `SessionRegistry` now supports `activeCountByAccount()`, optional `maxActiveForAccount` with 429 `account_session_capacity_reached`, and counts HOLD retained sessions but stable lane reuse does not consume another slot.
- `OPERATOR_SCOPED_SESSION_LIMITS=1` feature flag (OFF by default) derives Free/Pro account session ceilings, and uses a bounded 128-session global registry ceiling unless an existing explicit environment ceiling overrides it. No default production behavior change without opt-in. API can advertise `sessionLimit` and `agentConcurrencyTarget` (clearly a target, not a live Agent concurrency claim).
- Integrated bounded per-account cap into existing account/device context and plugin session-open route, without bypassing the already signed node session ceiling. Internal client-update paths exempt from the ordinary account cap.
- Team preview retains existing `maxWorkers=3` and adds distinct **`agentConcurrencyTarget=5`**, `sessionLimit=20`, `sessionsPerSeat=4`, `agentsPerSeat=2`, no billing or cross-account dispatch mutation.
- Gold CI workflow includes `selftest-gold-multi-agent-entitlement.mjs` for isolated Free/Pro account session caps, hold reuse, legacy node ceiling, Team billed owner identity and old worker-vs-new Agent target separation.

## Verified acceptance / scope limits

**PASS:** `selftest-gold-multi-agent-entitlement.mjs` all 5 markers, `selftest-gold-team-scoped-revoke.mjs`, `selftest-gold-team-license-native.mjs`, `selftest-gold-session-redis.mjs`, `selftest-g3-fleet-channel-stale-inflight.mjs`, `selftest-g3-command-liveness-pulse.mjs`, `selftest-g4-gold-durable-operation-claim.mjs`, syntax and diff checks. No signed device permission relaxed.

**FIXTURE ENVIRONMENT LIMITATION:** older `deploy/scripts/selftest-session.mjs` cannot boot Gold Operator as standalone without `LIGHT_REMOTE_GOLD_INDEPENDENT=1` and the real PostgreSQL/Redis infrastructure; failure is `gold_independent_mode_required`, NOT session logic. Do not bypass Gold backend or claim that legacy fixture passed. Gold unit+Redis tests above are reliable.

**NOT YET DONE:** Running feature flag on physical Gold UAT Operator, independent Agent identities on devices, Pro three actual simultaneous Agent execution, Free fairness queues, Team live dispatch/owner metering, unified automatic background `exec(auto)` handling, cancellable real job supervisor, resource locks, Wall product UI and Windows owner install of newer Gold Agent. **M1–M6 are NOT globally accepted.**

**Rollout:** Gold-only source + CI first, then isolated `light-remote-gold-uat` guarded stage/backup/cutover with device health verification. Keep scoped flag OFF unless a controlled Gold UAT opt-in migration is validated. Never touch production or apply Windows updates silently. Review the final Git commit/CI status in the following checkpoint.

**Out-of-scope unrelated worktree files:** `deploy/gold-uat/`, `deploy/scripts/check-gold-db.mjs`, `deploy/scripts/uat-gold-account-device.mjs`, `deploy/scripts/uat-gold-http-api.mjs`; leave untracked/unmodified.
