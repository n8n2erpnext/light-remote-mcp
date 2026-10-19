# G1 Gold — previously blocked fixes retried, verified, and deployed (2026-10-19)

## Scope, branch and checkpoint
Repository `n8n2erpnext/light-remote-mcp`, **existing** branch `feature/light-remote-gold-rebuild-20261018`.
Starting Git HEAD: `b46b12752a3f8ef1df46f6949b374f46ff43a345`. Gold owner-authorized development via official Light Remote connector, Gold testing via **separate Gold MCP connector**, Gold-only LXD `light-remote-gold-uat`.

**G0 COMPLETE; G1 critical source regression GREEN and signed Gold MCP command transport REAL PASS; residual platform pre-dispatch false positive remains; G2–G6 not started.** No production service/code/credentials changed.

## A. Linux capability inference security regression — FIXED

Original evidence: `a54c348` (RED test, reverted by `e844f6c` to keep CI green) demonstrated `systemctl is-active\ndocker` being mistaken for a single service query by the JavaScript `\s` regex, suppressing `docker` capability even though newline separates Bash commands. That is a potential capability under-classification, distinct from actual OS execution or OpenAI gate.

Owner explicitly requested **retry** of previously blocked legitimate Gold maintenance. Retried `light_remote_edit_file` once with the original exact target text; tool returned **ok, one replacement**. In `device-agent/platform-adapters/linux.mjs::classificationInput()`, the narrowly scoped readonly `systemctl` matcher now allows only **SP/TAB** between words and at boundaries; **NO change to actual script being executed**, broad Linux deny policy, A/B, OAuth, declared required capabilities or Agent final authority.

Restored the prior RED fixture into current tree from commit `a54c348` now that it is expected to be GREEN:
`deploy/scripts/selftest-gold-linux-systemctl-whitespace-boundary.mjs`. Checked with the standard `selftest-*.mjs` runner naming (GREEN, not a breaking RED fixture).

**Actually run PASS:**
- New newline regression **22/22** (space/tab good; LF/CR/command separators/substitution require Docker).
- Existing status/service inference **36/36**.
- Existing journalctl unit inference **40/40**.
- Linux/Windows/macOS Operator–Agent parity **13/13**.
- Leaf capability provenance, policy revision diagnostics, MCP OAuth/validation boundary, and **80 registered MCP tool contract** tests PASS.
- Platform adapters cross-platform and signed device-policy regression PASS.
- Source syntax and `git diff --check` PASS.

Deployed **one Linux adapter module only** into `/opt/light-remote-gold-uat/device-agent/platform-adapters/linux.mjs`; Gold Operator+Plugin restarted to load new code. Gold services **PostgreSQL, Redis, Operator, Plugin, Wall 5/5 active**; Gold account HTTP 200, production HTTP 200.

## B. Gold command encryption missing — RESTORED via normal authorized maintenance

Prior G1 Gold MCP always returned `operator_public_key_unavailable` because Gold Plugin lacked `OPERATOR_PUBLIC_KEYS_FILE`, and Operator's `OPERATOR_KEY_FILE` pointed to an unrelated existing RSA PEM. The actual protocol uses **X25519 DER, JSON keysets** (`gateway/operator-crypto.mjs`, `operator-host/crypto.mjs`); the Gold-only keyset had never been provisioned.

The owner explicitly requested retry of previously blocked authorized fixes. Through normal official Light Remote exec targeting only **Gold LXD**, the **existing project generator** `deploy/scripts/generate-operator-key.mjs` successfully generated:
- Public `/var/lib/light-remote-gold-uat/operator/envelope.public.json` (**0644**, owner `gold-uat`).
- Private `/var/lib/light-remote-gold-uat/operator/envelope.private.json` (**0600**, owner `gold-uat`).
- Existing RSA PEM was preserved, not overwritten; no private key content was read, printed, copied to Git/ChatGPT or backed up externally.
- A self-contained **seal→decrypt roundtrip** using the installed Gold JS modules returned `GOLD_X25519_ENVELOPE_ROUNDTRIP=PASS`.

Set Gold-only systemd drop-ins, both `0644` and containing **paths only, no key material**:
- `/etc/systemd/system/light-remote-gold-operator.service.d/40-gold-envelope.conf`: `OPERATOR_KEY_FILE=/var/lib/light-remote-gold-uat/operator/envelope.private.json`.
- `/etc/systemd/system/light-remote-gold-plugin.service.d/40-gold-envelope.conf`: `OPERATOR_PUBLIC_KEYS_FILE=/var/lib/light-remote-gold-uat/operator/envelope.public.json`.

After `daemon-reload` and restart of **only Gold Operator+Plugin**, Gold `light_remote_connection_helper({})` returned **ready** for the previously owner-A/B-authorized device and durable session (no A/B restart or production connector substitution).

## C. Signed Gold MCP REAL E2E evidence
Run through the **Gold connector**, NOT official production MCP:
- Gold `light_remote_exec` simple `printf`: **job state ok, exit 0**.
- Same with explicit `requiredCapabilities=['filesystem']`: **job ok, exit 0**.
- After a **second Gold Operator+Plugin restart** for adapter patch, resumed existing Gold session: benign `printf` **job ok, exit 0**.
- Git tool command `git --version` with explicit `git`: **job ok, exit 0**.
- `apt-cache policy bash` with explicit `package-manager`: **job ok, exit 0**.
- `systemctl is-active docker` with explicit `systemctl`: **job admitted and executed, exit 4** (target system's service status, **NOT** a Fleet capability denial).
- `systemctl is-active ssh`: **job admitted and executed, exit 3** (service status).
- `docker --version` with explicit `docker`: **denied** `target_node_capability_missing`; current Gold Agent/Enrollment has no Docker. Gold `recent_activity` contains **two** `job_admission_denied` events with `missingCapabilities=['docker']`, `missingCapabilityReasons.docker='enrollment_not_approved'`. Expected fail-closed result.
- **Residual platform issue:** an authorized read-only Gold MCP `lxc --version` call was denied **at OpenAI pre-dispatch**; no Light Remote capability/Agent verdict can be inferred from that attempt. Do not relabel it as a Fleet bug or circumvent by PTY/different tool. Report sanitized event through appropriate platform feedback if necessary.

## D. Critical boundaries and remaining work
1. These tests demonstrate **Gold Linux** signed MCP exec E2E and fail-closed capability admission after restart, not a proof that every Windows/macOS Agent or all 80 tool families are E2E tested.
2. A platform pre-dispatch refusal still cannot be fixed by Light Remote changing server code. The **real cause of RDC appearing to be blocked less often remains unproven**; no promise to override OpenAI policy or design tools to conceal a command.
3. Gold encryption configuration and private/public keys live **only in Gold LXD, not in Git**. Recreating the Gold container requires authorized replay of the generator+systemd drop-ins, then the same crypto and E2E acceptance, with no publishing private material. Never reuse Gold key material in production.
4. No PostgreSQL schema changes, no new JSON business-state snapshot, no OAuth/A-B privilege changes, no secret disclosure, no production deployment.
5. G1 core blockers are resolved on Gold; additional acceptance can cover precise error taxonomy cross-client, reconnect, and cross-OS signed tool calls. Do not advance to G2 without reporting remaining scope honestly.
6. G5 requirement remains **SCP upload/download real progress (bytes, %, phase, verification) on authenticated NetBird Wall**, not implemented in this checkpoint.

## Rollback, continuation and next step
- Linux parser rollback: revert `device-agent/platform-adapters/linux.mjs` to `b46b127` and restart **Gold** Operator, but note that doing so restores the reproduced capability bug.
- Crypto rollback: independently managed Gold-only systemd override rollback (remove the two `40-gold-envelope.conf` drop-ins and daemon-reload/restart) returns Gold MCP to the **known broken** pre-fix state; **do not delete keyfiles or restore old RSA by accident**. Maintain production untouched.
- Continue from `docs/optimization/RDC_HANDOFF_CURRENT.md`; read this checkpoint first. Upcoming slice: G1 admissibility matrix and sanitized pre-dispatch denial report, then owner-directed G2 start gate. Do not rerun Gold pairing; reuse valid A/B-approved session.
