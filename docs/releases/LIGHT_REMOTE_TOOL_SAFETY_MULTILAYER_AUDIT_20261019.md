# Light Remote Tool Safety — multilayer direct-tool audit (2026-10-19)

## Target, scope and rules
- Tested **official Light Remote Plugin** against the already A/B-authorized VPS-ARM (Ubuntu ARM64) through direct individual MCP calls. Did not switch targets after any denial; used managed PTY only for separate legitimate terminal tests, never to retry denied shell operations.
- Source patch/deployment target: branch `feature/light-remote-gold-rebuild-20261018`; isolated `light-remote-gold-uat`. Production plugin/server were **not redeployed** or had governance policy broadened.
- Examined layers separately: OpenAI pre-dispatch tool gate, OAuth/Plugin schema, Operator/Fleet admission, device-side capability inference and allowed roots, Linux execution, and Gold feature parity.

## Observed PASS — real official Plugin MCP calls
- Device inspect, recent activity, connection helper and durable session resume. VPS-ARM reported 9 allowed capabilities: build-test, docker, filesystem, git, lxd, package-manager, sudo-on-demand, systemctl, terminal; profile self-hosted-owner, localFinalDeny=true.
- Native file system: mkdir, file write, read, edit, stat, list, copy, move, read_multiple, content search/results, delete; all allowed operations passed on an isolated `deploy/.lr-safety-smoke` directory. Scratch directory removed.
- Real exec jobs: Bash, git status, Docker ps/info, LXD list and guest read-only hostname, systemctl is-active, journalctl metadata, apt-cache policy, sudo -n true, Node and build-test, network socket listing, hardware lsblk; exited 0 when tested as specified.
- Managed process: create, bounded stdin, stdout/stderr, list, graceful stop. Terminal: launch, stdin, output, resize, list, interrupt and close. Output verified matching probe markers.
- SCP download: begin, one chunk with matching hash, status complete, cancel. SCP upload: begin, status and cancel; **commit NOT accepted** (see confirmed bug).
- Correct denials: a nonexistent path under allowed roots yielded `filesystem_path_not_found`; native file read of benign `/etc/os-release` outside configured roots yielded `filesystem_path_outside_allowed_roots`. Not bypassed via shell.
- Real Remote desktop **status** on headless Linux yielded `target_node_capability_missing`, expected without a desktop provider; desktop attach/move/click/type were not tested.

## Confirmed discrepancy A — OpenAI pre-dispatch false positive (NOT controllable in Light Remote code)
A read-only shell `find`/multi-pattern `grep` inspecting capability-inference and denial code in the repo was refused by OpenAI safety before an MCP device job was admitted. Other Docker/LXD/sudo read probes succeeded. This is not a Linux permission error or evidence that local device policy denied those operations. The denied command was **not** retried through PTY, another target, or an alternate tool. Exact details are recorded in the originating ChatGPT tool transcript; the server cannot waive OpenAI's checker.

Recommended external remediation: report a sanitized transcript consisting of the specific benign read-only command, action/tool name, whether a device job ID was assigned, and the provider rejection. Do not teach fallback to PTY or alternate tool after such denial.

## Confirmed discrepancy B — inconsistent capability inventory (fixed in Gold source and demonstrated on Gold)
At the same moment, official `light_remote_inspect_device` returned 9 approved/effective capabilities (including Docker), whereas official `light_remote_list_devices` returned an **empty capabilities array** for that device. Separately, a **read-only** explicit `requiredCapabilities=['docker']` exec was refused with `target_node_capability_missing`, despite an ordinary Docker read command returning exit 0.

Root of visible inventory inconsistency: `plugin-server/operator-adapter.mjs` maps the scoped `/v1/agent-client/:id/devices` **binding summary**, which may omit `effectiveCapabilities`, directly into the public list/helper. `inspectDevice()` instead reads authoritative `/v1/devices/:id` details.

Gold-source fix: `authorizedDeviceDetails()` enriches **only already A/B-authorized IDs** with the authoritative owner-matching detailed device view. If details fail or fail ownership check, retain only authorized binding metadata rather than revealing another device. `devices()` and helper topology now use the enriched view.

After deploying only the adapter into Gold Plugin, actual **Gold connector** `light_remote_list_devices` and `light_remote_connection_helper` reported the same nonempty capabilities as Gold `inspect_device` (**PASS**).

**Limit:** the explicit Docker job-admission mismatch on the **official production** plugin remains unverified after any production upgrade (none was performed). Do not interpret list visibility repair as proof that Operator/Fleet has fixed all capability admission decisions.

## Confirmed discrepancy C — SCP upload chunk SHA-256 (fixed in Gold source, Gold E2E not yet accepted)
- Official SCP upload began, but a standard padded base64 string failed `scp_invalid_chunk_encoding`: the declared protocol requires **canonical unpadded base64url**. This is expected protocol validation, not OpenAI safety.
- Canonical unpadded base64url then failed `scp_invalid_sha256` with no progress. The old agent-side upload layer required chunk SHA but the installed official MCP tool exposes only `transferId,index,data`.
- This is independently reproduced by existing `selftest-v10-light-scp-routing.mjs`: before fix, assertion `scp_upload_chunk_hash_must_be_forwarded` failed.
- Fixed `plugin-server/tools.mjs` by declaring optional per-chunk `sha256` in the server schema, forwarding the value when provided, and **deriving a canonical SHA-256 from the chunk bytes in Plugin when omitted**. The device still verifies supplied chunk SHA and ALWAYS verifies whole-file SHA before commit. No bypass of filesystem roots, transfer integrity or device authorization.
- Added runnable `deploy/scripts/selftest-v12-scp-chunk-compat.mjs` (positive canonical base64url and negative malformed/noncanonical cases). `selftest-v12-scp-chunk-compat`, `selftest-v10-light-scp-routing`, `selftest-v10-light-scp-file` all **PASS** after source fix. Adapter syntax + capability-inference selftest PASS.
- Updated **Gold Plugin only**; Gold WebUI and production WebUI each remained HTTPS 200.
- A separate attempt to run Gold's SCP E2E via Gold authorized client hit `operator_public_key_unavailable` at **Gold remote filesystem admission**, before chunk transfer. Therefore **real Gold SCP upload+commit is not PASS** yet. Investigate independent Gold public-key propagation and rerun the E2E after it is fixed.
- Official production Plugin/Agent versions were not updated in this audit. Their old SCP upload error can persist until a compatible signed deployment is made.

## Test environment caveats
- `selftest-v10-host-exec-capability-inference.mjs` exited 1 with `operator_not_ready`: requires a specific ephemeral IPC server, not proof of failed inference.
- `selftest-v10-account-routing-isolation.mjs` exited 1 with `gold_independent_mode_required`: ran from worktree without required independent Gold runtime environment, not a tool policy denial.
- Deliberately **not** run: Main switch, revoke/remove paired device, destructive Linux commands, host package installation, production daemon restart, real desktop input on headless VPS, privilege escalation beyond benign `sudo -n true`, and unsafe/dangerous command variants. Those need separately authorized isolated test environments and must never be attempted as a workaround to a policy refusal.

## Source and release status
- Gold branch source: `plugin-server/operator-adapter.mjs`, `plugin-server/tools.mjs`, and `deploy/scripts/selftest-v12-scp-chunk-compat.mjs`.
- Gold Plugin received source updates and its list/helper capability response was validated with the Gold connector.
- Production Light Remote plugin and production clients remain **unchanged**. All findings and the code patch must be reviewed/released through normal signed upgrade workflow, not by weakening deny policy.
- Future fixes: reconcile authoritative Operator/Fleet admission capability data (separately from the fixed list API), restore Gold operator crypto public-key readiness, reproduce an official post-release SCP upload/commit on a scratch file, and route the isolated OpenAI pre-dispatch refusal transcript through platform support.
