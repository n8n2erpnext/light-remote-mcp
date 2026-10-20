# Gold G3 — Agent-native independent executor readiness canary

2026-10-20 | Branch `feature/light-remote-gold-rebuild-20261018` | Baseline `d593bc0` | **G3 partial, real enrolled Agent E2E remains open**.

## Diagnosis and boundary
Prior Gold G3 signs `executorReady` from the Agent's own unresolved command Promise tracking; Agent TCP heartbeat can remain healthy while native process creation fails, so it should not be the sole admission proof. A native canary is an independent, bounded operating-system *process-spawn* signal, not proof that a particular customer shell, filesystem, process, PTY, or desktop side effect finished. Never use probe failure to replay a user command.

Inspection of real UAT:
- The Gold Plugin canonical origin is `https://gold.light-remote.thaiduy.digital`, configured in the running **isolated Gold UAT**. HTTP `/api/operator` at that canonical HTTPS origin exposes only bootstrap operations such as `enrollment-begin`, `enrollment-poll`; unsupported `ping` is correctly denied with HTTP 403 `public_operator_action_denied`. Direct raw-IP access is denied by the MCP Host validator, as designed; leave the guard enabled.
- The live UAT Operator is older than the current Gold source (fleet/router and device-channel module hashes differ). Its two previously connected leaves report `executorReady=null`; legacy/unknown is not a native executor PASS.
- Approving a disposable Agent requires a genuinely authenticated owner account session on `/v1/accounts/enrollments/approve`. A credential-copy operation was denied by the execution safety boundary; do not route around it, claim approval, or use a production identity. **No enrolled Agent E2E was completed in this checkpoint.**

## Source change
- New `lib/executor-readiness-probe.mjs`: `ExecutorReadinessProbe` launches the local Node executable as a short, input-free child with a fixed benign argument and bounded timeout (default 5s; cap 20s); no customer command, credential or process stdout is inspected or sent. Repeats no more frequently than a bounded interval (default 30s). Two successive failed canaries mark `ready=false`; a fresh successful process marks true. Initial state `null` is distinct from healthy. On stop/restart, late probe responses cannot mutate current state; concurrent checks coalesce, and transition logs contain only sanitized status metadata.
- `device-agent/operator-agent.mjs`: start the canary at daemon startup, wait for initial readiness resolution before starting network command loops, stop on daemon shutdown, and combine canary result with the existing duplex unresolved-execution guard. All four Agent-reported `executorReady` payload paths (hello, heartbeat, fallback poll, drain poll) use this combined readiness. An unresolved execution always returns false regardless of canary. `status` CLI now reports probe state; the independent canary does **not** authorize pairing, grants, permissions or A/B by itself.
- Added to `client/core-files.json` so macOS Intel/Apple Silicon, Linux Desktop x64/ARM64 and Windows package a single shared implementation; added to both host/Wall install paths and the host installer import contract. All platform package smoke pipelines and dedicated Gold Operator CI run new regression.

## Regression
New `deploy/scripts/selftest-g3-executor-readiness-probe.mjs` checks:
1. A **real Node child** can be spawned, and nonexistent executable fails boundedly.
2. Channel freshness stays true while an independently failing executor canary transitions healthy → unavailable on the second failure; Fleet returns `target_node_executor_unavailable` (409) for new admission.
3. Further failures/heartbeat updates do not spam changes; a fresh successful probe restores the ability to dispatch.
4. A cancelled asynchronous probe cannot override newer lifecycle state.

**VPS-ARM Node 22**: all four `G3_*_CANARY/PROBE` markers PASS. Previous hang readiness, duplex reconnect, host installer contract and Client core stage/verify PASS.

**Real Linux Server UAT LXD**: staged `lib/executor-readiness-probe.mjs`, FleetRouter and new test only under `/tmp/g3-executor-probe-20261020`; test runs within `light-remote-gold-uat` ARM64 and four markers PASS. Host and staged module SHA-256 match `79ac9200938cf7645d4238cc2562529fa4787d912ee037e89967a83ae6dcfb98`. Live Gold Operator Unix IPC HTTP 200 and PostgreSQL/Redis/Operator/Plugin/Wall 5/5 active; **no installed service replaced**.

## Acceptance still open
- Exact Windows/macOS/Linux and Gold CI runs must be observed after push; do not infer a green pipeline from a local fixture.
- No actual **owner-approved, enrolled** disposable Agent has yet reported independent canary state over a live signed channel to the current Gold Operator build, and no stop/restart replay effects were tested.
- Canary validates Node child-process creation only. Native ProcessRegistry/TerminalRegistry internal availability, event-loop starvation, OS suspend/resume and long-lived service leak/latency remain separately measurable. G4 still owns cross-restart effect reconciliation.
- Keep unrelated untracked Gold UAT source and shared production/owner-installed clients untouched. No rollback, updater or license state changed.

Next candidate: make current Gold Operator code available to an isolated disposable enrolled UAT identity **only through the user-authorized test account and approval flow**, and perform real Agent health fault injection with independent OS observation before G3 gate closure.


## Hosted CI acceptance — source 007ac71
Source [`007ac718d6d20893a65dce82732f5e541b5757cc`](https://github.com/n8n2erpnext/light-remote-mcp/commit/007ac718d6d20893a65dce82732f5e541b5757cc):
- [Gold G3 Operator Regression #4](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39423200013): **4/4 SUCCESS** — Operator contract (four independent process-canary markers verified in job log), x64/arm64 server bundles and bounded soak.
- [Linux Desktop Packages #286](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39423200001): **x64 and ARM64 SUCCESS**; all four independent canary markers verified in each job log.
- [macOS Packages #244](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39423200046): Apple Silicon ARM64 and Intel x64 **SUCCESS**, all four new canary markers verified in both platform logs.
- [Windows Tray Client #448](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39423200167): native bundled runtime smoke/installer job **in progress** at first checkpoint; do not claim final installer PASS without completed run.
These CI checks execute an isolated real OS Node child from the shared module. They do not prove macOS native desktop input or an installed Owner Agent, nor fix unavailable authenticated Gold UAT enrollment.
