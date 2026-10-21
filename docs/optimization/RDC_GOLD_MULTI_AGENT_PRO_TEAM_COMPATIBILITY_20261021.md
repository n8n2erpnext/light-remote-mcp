# Light Remote Gold — Pro Personal / Pro Team quota and concurrency allocation

**Updated 2026-10-21 — owner clarification is authoritative.** This document supersedes the earlier draft's *member's personal-plan concurrency deducted during Team work* and its proposed Team pool of 3. **These are product design targets, NOT implemented quotas.** No runtime, billing, pricing, OAuth/A/B or production mutations have occurred.

**Linked plan:** [Multi-Agent / Job Scheduler Master Plan](./RDC_GOLD_MULTI_AGENT_JOB_SCHEDULER_MASTER_PLAN_20261021.md). **Measured baseline:** [Gold Windows/Linux real curl test](./RDC_GOLD_MULTI_AGENT_EXISTING_LIMITS_BASELINE_20261021.md).

## 1. Owner's corrected product model

- **Free**: one individual; 2 retained active/hold sessions across their devices, **1 currently executing Agent**; further authorized Agents can queue.
- **Pro personal**: **one paying individual**, up to **12 retained sessions** across their devices and **3 executing Agent identities concurrently**. Multiple ChatGPT sessions are legitimate; opening a session does not itself occupy a live Agent slot. Unrelated `curl/wget/build` jobs run as bounded background workers without holding a foreground Agent slot.
- **Pro Team**: **up to 5 human seats inclusive of Team owner**, each member individually invited/accepted and scoped to shared owner devices. All permitted Team member tool calls are **attributed and metered to the Team owner's account/add-on usage**, never deducted from the member's personal Free/Pro tool-call quota. **20 Team sessions shared**, **up to 4 retained Team sessions per human seat**, **5 executing Agent identities shared across all Team-owned shared devices**, **up to 2 concurrently executing Team Agents per seat**. One slot per waiting person is given scheduling preference before granting idle surplus capacity to a second Agent of the same person. There is **no hard reservation that wastes unused slots**.
- A member with only a personal **Free** subscription can perform Team jobs using the **owner's Team entitlement**. Their personal 1-Agent/Free tool-call quota is applied to **personal jobs on their own devices only**, not to team work. Conversely, Team entitlement does not upgrade personal work or authorize other devices.
- Owner's private Pro context and Team membership remain distinct. Owner's jobs **on a Team-shared device** participate in Team pool fairness/worker locks and the per-seat Team cap; owner's **private device not shared to Team** uses personal Pro slot/session caps. Device worker budgets/resource locks still apply across both kinds of work when they reach the same device.

### Proposed visible limit matrix

| Policy | Free personal | Pro personal | Pro Team workspace |
|---|---|---|---|
| Paying principal | individual | individual | **Team owner** |
| Membership seats | 1 | 1 | **5 total incl. owner** |
| Retained sessions (active + hold, not concurrently running) | 2 account-wide | **12 account-wide** | **20 Team-wide**, max **4/member** |
| Concurrent executing Agents | **1 account-wide** | **3 account-wide** | **5 Team-wide**, max **2/member** |
| Additional authorized Agents | fair queue | fair queue | fair queue across members, favor distinct members |
| Job/process concurrency | independently bounded per device/account | independently bounded per device/account | independently bounded per owner Team pool/member/device |
| Tool-call usage attribution | individual | individual | **owner Team account/add-on**, with member actor audit |
| A/B device approval | required | required | **separate signed A/B for each member's Agent** |
| Device ownership | direct owner | direct owner | only owner-provisioned, explicitly shared devices |

**Session cap applies to active+hold records, not tool-call concurrency.** Idle/held sessions do not consume the active Agent pool. Session expiration/eviction and reconnect must not silently kill authorized detached background jobs. An Agent may have multiple sessions, but slot accounting is by stable authenticated Agent identity and active work lease, not number of sessions or caller-submitted text labels.

## 2. Real source status (don't confuse this with the product target)

`operator-host/pro-team-registry.mjs` currently fixes `MAX_SEATS=5`, requires an **independent owner Pro/VIP Team add-on**, and revokes member A/B on remove/unshare/expiry-related operations. Existing `monthlyMemberCallBudget` **defaults to 5,000** and is attached to the **owner's Team add-on**; do not silently remove this existing budget, multiply it per member, or pretend the owner Pro account's unlimited personal calls automatically remove Team member-budget restrictions.

`operator-host/team-entitlement-policy.mjs` presently returns `maxWorkers=3`, and `operator-host/team-dispatch-authority.mjs` caps the trusted preview at 3. **M3-T implementation must explicitly and consistently migrate these policy hints to the approved Team target of five executing Agent slots**, distinguishing `agentConcurrencyLimit` from `workerConcurrencyLimit`; the old `maxWorkers` term cannot safely be reused for both concepts. Do not change either as an incidental personal M3 commit.

`operator-host/executor-routes-account.mjs` currently has `crossAccountExecutionEnabled:false`; preflight is UAT preview only, `teamSessions=null` in `executor.mjs`, and Team cross-account jobs are not live. Existing signed OAuth Team actor verification, independent member A/B, shared device eligibility and owner-paid billing identity must remain enforced on every future Team job.

**Metering contract**: For Team jobs record `actorAccountId`, `agentId`, `teamOwnerAccountId`, `billedAccountId=teamOwnerAccountId`, `deviceId`, `jobId`, `operationId`, `usageOwner=team`, `seatId`. Apply exactly-once charge-event attribution to **the Team owner's account**; decrement/enforce owner Team add-on's configured `monthlyMemberCallBudget` for member calls when active and display usage on owner's Team dashboard. The owner's personal Pro unlimited setting is distinct from any explicit Team budget; decide any Team budget expansion through product/billing, **not this scheduler patch**. Keep per-member usage breakdown for audit/fairness, but **do not charge their personal Free/Pro monthly call quotas** for Team jobs. Calls by Team owner within Team workspace are included in Team owner usage, with separate consistent classification and no duplicate counting.

## 3. Correct admission ownership — single Team pool, not dual personal subscription admission

Previous draft's proposed dual admission **(member personal Free/Pro slot + Team pool)** is **withdrawn**. It would force Free member work to consume personal entitlements despite the owner paying. Use a server-authoritative **billing/execution context** instead:

- **Personal job on own device:** scope `personal:{actorAccountId}`; use actor Free=1/Pro=3 active Agents, personal session cap 2/12, personal quota and device capacity; no Team side effects.
- **Team workspace job on owner-shared device:** scope `team:{teamOwnerAccountId}`; use **Team pool 5 active Agents**, **per-seat max 2**, Team session cap 20/4-per-seat, Team owner calls quota/budget and owner-owned shared device budget. **Do not additionally reserve the member's personal Agent slot**. The member is still the **actor** for consent/ownership/audit. The Team owner acts as an ordinary seat inside the shared Team pool on Team-scoped work.
- **If actor is in multiple Teams:** scope all jobs to the appropriate verified owner Team; no cross-Team quota sharing. All Team access must have distinct owner/device/grant contexts, and per-device resource locks always serialize conflicting work independent of Team membership.
- A job started in one scope never automatically migrates into another scope when account plan changes, Team membership changes or an Agent reconnects. Apply grant/entitlement revalidation/fencing instead.
- Claims of `teamOwnerAccountId`, owner billing identity and session pool come ONLY from trusted OAuth and Operator device/team registries, not from a tool or web client field.

**Fair scheduling:** strict owner/team shared pool upper bound; favor distinct waiting Team seats; optionally allow a second Agent for a member when unused slot is free. A Team worker-heavy `curl`/build may release the foreground Agent slot only after it occupies a bounded background-worker quota. Long background jobs cannot be unlimited just because member Agents are queued/released.

## 4. OS device resource fairness is separate

The 5-Agent Team cap is a **scheduling entitlement**, not an instruction to start 5 heavy compilers on a 2-vCPU LXD. At every eligible dispatch:
1. Verify current signed OAuth actor+Agent identity; active seat/team add-on and owner's Pro/VIP plan, device ownership+sharing, per-member Local Wall A/B, connection/grant TTL and capability policy.
2. Reserve a **Team Agent execution lease** (5 total, max 2 per seat) and any device-worker/resource lock, in one fenced, atomic PostgreSQL decision across Operator instances.
3. If Team pool is full: **QUEUE** with `TEAM_AGENT_SLOTS_FULL`; if worker/device capacity is full: queue with `DEVICE_WORKER_CAPACITY`; project conflict: `RESOURCE_LOCKED`. None of these means `DRAINING`.
4. If user/owner revokes member, unshares device or Team add-on expires: cease new Team work immediately, discard/revalidate queued jobs and reconcile only affected member jobs according to owner cancel/grace policy. No unrelated member's jobs should be terminated.
5. Authenticate owner Wall cancellation independently from member ownership. Member can see/manage own Team jobs, but cannot inspect or stop another member's job without explicit delegation. Preserve team actor and owner payer attribution in every audit record.
6. Never accept a Free member's Team entitlement as permission to execute on a private unrelated device or waive device safety checks.

## 5. UAT matrix and M3-T gate

| Case | Acceptance |
|---|---|
| Pro personal opens 12 signed/authorized sessions across devices; 3 Agent identities execute | All 12 sessions may persist; only 3 Agents execute concurrently, fourth queued. Held session is not running slot |
| 5-person Team (owner+4 members) opens 4 sessions each | Exactly **20 Team retained sessions**; overflow rejected/expired according to explicit session policy, without eating Agent slots |
| Five distinct Team seats submit independent commands | Five concurrent Agent admissions permitted when device resources allow; sixth queued. At most two executing Agents per seat |
| One member starts two Team Agents while others wait | First-per-waiting-seat fairness gives other members a chance; no starvation, second from same seat uses spare capacity only |
| Free-plan member works on owner's Team-shared device | Team session/Agent permission from owner Team and A/B; Team calls counted to owner. Member's own Free 10k-call counter and personal 1-Agent slot unchanged |
| Owner starts personal Pro commands on an unshared device | Personal Pro 3-agent/12-session scope; unrelated member Team jobs are not charged or blocked by owner's private agent slots |
| Owner and members concurrently use one Team-shared device | Same 5 Team pool, resource lock and device worker budgets; cannot bypass as owner direct `targetRoute` |
| Team add-on missing, revoked or member lacks independent A/B | Explicit denied, no job submission via personal owner route or preview bypass |
| Team `monthlyMemberCallBudget` reached | Honest Team quota response (configured owner add-on); never decrement personal Free member counter |
| Network fail, agent reconnect, G4 same `operationId` retry | One team-owner usage debit and one canonical job; worker/actor identity not silently transferred |
| Remove member/unshare/revoke mid-job | New jobs denied, queued jobs fenced, affected running jobs canceled/drained by owner policy, unrelated jobs unaffected |
| Existing preview disabled | `crossAccountExecutionEnabled=false` until explicit M3-T product + security acceptance, source migration and owner approval |

**Rollout strategy:** M3 personal scheduler first. The Team workspace rules in this document are to be implemented under separate **M3-T** gate with a distinct flag and signed OAuth/session integration. Do not silently migrate the existing 3-worker Team preview or enable cross-account execution as part of ordinary Pro fixes.

**Implementation status:** PLANNED ONLY. No change to entitlement code, account quotas, Paddle billing, Team grants, Live/Production, installed Windows build, device configs or actual Team membership. The only modifications are this plan and its master-plan/handoff references.
