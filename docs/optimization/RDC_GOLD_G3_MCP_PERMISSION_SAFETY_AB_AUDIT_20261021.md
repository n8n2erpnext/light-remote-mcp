# Gold G3 — Production vs Gold MCP execution / permission / ambiguous-denial audit (2026-10-21)

## Goal / scope

Owner requested a **real A/B test** of sensitive-looking infrastructure commands and structured filesystem tools, focusing on intermittent pre-dispatch ChatGPT/Claude tool refusals, MCP filter false positives, privilege mismatch, and ambiguous output causing pointless retries. Two owner-authorized plugins were invoked directly:

- **Official production Light Remote**, device `direct-arm-local`, VPS-ARM main, self-hosted-owner profile. **Read-only tests only; no production writes, restarts, config, or deploy.**
- **Light Remote Gold**, device `light-remote-gold-uat` isolated LXD on same VPS-ARM, default profile, current Gold Operator strict admission ON, Gold-only auto-inline small stdout ON.

Gold and production have different effective local policies, OS namespaces and execution identities; they are **not identical permission baselines**. Production capabilities include `docker`; Gold profile does not. Both advertise `sudo-on-demand` and `lxd`, but this audit found Gold cannot exercise them as the names alone would suggest. Comparing a Gold legitimate OS denial to a production pass **cannot be called a ChatGPT safety false positive**.

Before use, official plugin skills for connection, remote operations, and device policy were read. Both helpers returned ready. Device inspect and recent-activity were reviewed. Device-local policy remains the final deny boundary. Never bypass/alter it, escalate privileges, retry a policy denial through a different tool, or infer its cause from server log alone. No passwords, private keys, API material or raw journal/firewall rules were gathered.

## Read-only shell / policy A/B (9 exact paired categories, 18 direct jobs)

| Probe / command category | Official production | Gold UAT | Interpretation |
|---|---|---|---|
| `systemctl list-units --type=service --state=running` (count) | Exit 0 | Exit 0 | Both permit read-only systemd inventory |
| `sudo -n id -u` | Exit 0 | **Exit 1** | Gold stderr: `The "no new privileges" flag is set`; Linux/sandbox restriction, NOT MCP/LLM pre-dispatch safety |
| `ip -brief link show` (count) | Exit 0 | Exit 0 | Both permit NIC inventory |
| `lxc list --format csv \| wc -l` | Exit 0 | **False PASS**: pipeline exit 0 but LXD stderr says not in `lxd` group / cannot install snap | Shell pipeline masks underlying failure; must check stderr and `set -o pipefail`, not count as successful LXD access |
| `nft list ruleset >/dev/null` | **Exit 1** | **Exit 1** | Both stderr `Operation not permitted (you must be root)`; legitimate OS permissions; no sudo/PTY bypass attempted |
| `journalctl -n 5 --no-pager >/dev/null` | Exit 0 | **Exit 1** | Gold: `No journal files were opened due to insufficient permissions`; OS journal ACL |
| `sysctl kernel.unprivileged_userns_clone` | Exit 0 | Exit 0 | Both pass |
| `dpkg-query -W bash` | Exit 0 | Exit 0 | Both pass |
| `lsblk -dn -o NAME` (count) | Exit 0 | Exit 0 | Both pass |

Exactly **13/18 verified healthy shell executions**, **4/18 ordinary OS/permission failures** (Gold sudo, Gold nft, Gold journal, production nft), and **1/18 misleading shell false pass** (Gold LXD pipe). **0/18 MCP pre-dispatch tool-refusal exceptions** in this paired sample. No error/denial was bypassed via PTY, another account/device, or alternate privilege. Explicit production-only `docker ps -q >/dev/null` read-only execution also passed (1/1); Gold Docker was **not attempted** because its device effectiveCapabilities do not include Docker.

To sample intermittent behavior, repeated read-only `systemctl` and `ip link` twice on each target (8 extra independent tool invocations); **8/8 PASS first call, no retry**. These small samples do **not** prove never encountering the sporadic platform/tool refusals observed in earlier sessions.

## Structured filesystem tools — a real Gold MCP error representation regression

Direct `light_remote_stat_path` and `light_remote_read_file` targeting `/etc/os-release` are outside *both* device local permitted structured filesystem roots. Those denials are correct and should **never be bypassed with exec**. Baseline:

- Production: both returned ordinary machine-readable `ok:false`, `filesystem_path_outside_allowed_roots`, HTTP 403, job state error.
- Gold before patch: both returned correct structured `layer=device_local_policy, retryable=false, nextAction=use_authorized_path, httpStatus=403` but its Plugin set MCP `isError:true`. The ChatGPT host surfaced **`INVALID_ARGUMENT` runtime exceptions**, which hide the normal structured object and can encourage an Agent to misinterpret a valid nonretryable denial as a transient tool failure. This is a **Gold MCP response-presentation defect**, NOT proof that the outer ChatGPT safety system denied an authorized operation.
- Gold authorized structured action inside `/tmp`: `write_file → edit_file → read_file → delete_path` **4/4 PASS**; temporary file removed. Hence the filesystem tool family itself works in authorized roots.

### Gold-only code patch / regression / deployment

- Fix commit **`598dd7725ff8c5d752970925449091ee23791007`**, branch `feature/light-remote-gold-rebuild-20261018`, pushed.
- `plugin-server/tools.mjs::result` now treats only the **known, authoritative, nonretryable local filesystem path 403** as a normal *completed policy decision*: preserves `ok:false`, `error`, `layer`, `httpStatus`, `retryable:false`, `nextAction`, `jobId`, but omits MCP `isError:true`. It **does NOT grant filesystem access** or change policy/capabilities. Unknown, OAuth, fleet and other exceptional errors retain existing `isError` semantics.
- Regression in `deploy/scripts/selftest-gold-tool-error-origin.mjs`: explicit expected-denial non-exception contract, other error classes remain failures; OAuth/validation error boundary regression PASS. Gold G3 CI runs both.
- Immutable `598dd77` staged into isolated Gold LXD, package-lock parity PASS; backup code+systemd+local-state+Postgres pg_dump verified. Closed only our own Gold test session, preflight strict ON, 2/2 channelFresh+ExecutorReady, 0 active session/queued/inFlight.
- Guarded Gold cutover: correct source SHA, 10 consecutive health samples PASS, **strict admission ON preserved**. One transient `G3_GOLD_VALIDATE_EXECUTOR_PROOF_MISSING` appeared while the Agent was reconnecting during cutover, but stable 10-sample gate PASS and cutover exited 0. Earlier Gold candidate and rollback state retained. Gold inline stdout switch preserved.
- **Physical post-fix MCP negative test:** `light_remote_stat_path` on the same denied `/etc/os-release` returned normally (no host exception), with exactly `ok:false, error=filesystem_path_outside_allowed_roots, layer=device_local_policy, retryable=false, nextAction=use_authorized_path, httpStatus=403`. File still inaccessible. Installed candidate selftest PASS.
- Production plugin/source/daemon/wall untouched.

## Findings and next policy engineering tasks

1. **Fix accomplished:** known local 403 no longer appears as opaque ChatGPT `INVALID_ARGUMENT`; no privilege boundaries altered.
2. **Gold capability/effective-permission mismatch remains:** Gold `inspect_device` advertises `sudo-on-demand` but root escalation is blocked by Linux `no_new_privileges`; advertises `lxd` while process lacks `lxd` socket/group access. This should be reflected as unavailable/conditional in effective capability reporting or direct error details; **do not turn off no-new-privileges or grant lxd group solely to make tests green**.
3. **Shell pipeline false pass:** `lxc list | wc -l` resulted in `job.state=ok` although LXD failed. Teach diagnostic/probe scripts to use `set -o pipefail` and treat stderr/real exit code as decisive. Do not alter shell wrapper in a way that unexpectedly changes normal Agent command semantics without dedicated tests.
4. **Linux privilege errors are not MCP safety denials:** Gold sudo, journal, nft; production nft without privilege. Device policy and process sandbox still control access.
5. **Platform pre-dispatch ChatGPT safety false positives are outside Plugin's observation path:** none manifested in this small, explicitly authorized paired test. Earlier sessions reported occasional pre-dispatch refusal/retry behavior; not yet statistically proven fixed. A future controlled repeated test with comparable device policies, explicit first-call and retry metadata, and client-side pre-dispatch diagnostics is needed.
6. Gold remains an isolated UAT deployment with strict ON, inline ON; production not touched. G3 ongoing; G4 not opened.

## How to resume

Verify current commit/source, GitHub push, Gold 5/5 services and Fleet 2/2 fresh/ready, 0 queued/inflight. Do not modify anything when active jobs/sessions exist. Retain previous immutable candidates and their backups. Preserve the four inherited unrelated untracked `deploy/gold-uat/` and UAT scripts: **do not stage**. The latest master handoff and current handoff link to this document.
