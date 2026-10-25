# Light Remote Gold — G3 Account-first Memory Sync Handoff — 2026-10-25

> **UPDATE 2026-10-25 — supersedes historical manual grant steps below.**
> Code: `aa925ef` (simple Home Account device sync) + `cba6510` (live status refresh).
> Gold UAT services currently run `cba651004885d0dff0f43e0e6e1971d6aa4dc249`; 4/4 active. Snapshot `gold-before-one-switch-memory-sync-20261025`.
> The only normal user flow is: in **Long Memory → Memory Sync**, tick one or more enrolled account devices and turn **Sync ON**. Untick a device to cease new transmissions to it; turn **Sync OFF** to stop local sending/receiving. No per-scope Home picker, IP, JSON, fingerprint, manual revoke, or second-Wall invitation approval is required. Advanced scope editing, notes and manual diagnostics are collapsed.
> The owner-authenticated Home Wall saves the selection locally in `lm_sync_device_selection`. Each Home scope inherits `selected_devices` while enabled. The Gold Agent discovers signed device public keys, renews/rekeys scope grants as needed, sends signed invitations, and each enrolled Replica with Long Memory ON auto-accepts only an account-verified Home-signed invitation. All checkpoint frames stay E2EE; Operator only offers volatile TTL bounded transport; client retains SQLite durable ledger.
> **No claim of full two-device E2E acceptance yet.** Windows `DESKTOP-VA16D27` still runs an older installed Agent without the auto-accept logic. Candidate `cba6510` is staged and 101-file manifest-verified on Windows under `%LOCALAPPDATA%\\Light Remote\\G3-SimpleSync-cba6510` (NOT installed, preserving current product and A/B plugin access). A compatible Windows installation plus synthetic Home→Windows revision+ACK/offline test remains pending.
> All historical bullets below asking owner to separately revoke, authorize, open Replica Wall or approve invitations are **OBSOLETE** and must not be repeated to the user. The old signed grant may be superseded only by an active Home owner's Sync ON + device checkbox selection, which is explicit consent. Existing downloaded data cannot be erased remotely.



## Read first / operating contract

- Continue the **complete, original Gold product**, with optional Long Memory and Codex Bridge. **NO** separate Continuity/Project app, second Wall, cloud-stored Memory content, or user-entered Home IP/NetBird URL/JSON/fingerprints.
- Active branch: `feature/gold-m6-integrated-20261023`, repository `n8n2erpnext/light-remote-mcp`.
- Official immutable restore tag: `gold-restore-before-memory-codex-20261024` -> `ba579f8830a0654e8321204f17270db8d94c5593`. Do not move.
- ONLY LXD `light-remote-gold-uat`. Gold owner Wall: `http://100.94.184.141:5591/` (NetBird ingress, not ARM host's production :5491). Production unchanged.
- UAT systemd services operator/plugin/process-supervisor/wall all active, executable source `/opt/light-remote-gold-uat-candidates/6d5dd09dd772715ef9009d1454c5a172a7a2d1dc/` at final review.

## New commits and what they actually do

1. `387498d0ee75ebfbc2289c30339b6a7d1e8f72e6` — Account-verified Memory key directory; signed short-lived invitations; owner-facing device/Scope selection and Replica acceptance; bounded in-memory E2EE ciphertext/ACK relay through Operator; local daemon 25s tick, peer advertisement 90s. No durable Memory payload in Operator PG/Redis.
2. `75061a019471f30ea0e8f7e55a6cf3e93d252b16` — Add missing `memory-peers`, `memory-invites`, `memory-relay` to the PUBLIC Plugin device-channel action allowlist. The Operator independently verifies the signed enrollment binding and account.
3. `f11033c94490716f870786276cf1574da14edaf7` — Allow safe re-offer of the **same owner-approved grant** if an invitation expires or volatile rendezvous restarts. Same grantId, epoch, keys and ACK/outbox; no accidental revoke on ambiguous delivery failure. Changing a peer key still requires explicit revoke/reapproval.
4. `6d5dd09dd772715ef9009d1454c5a172a7a2d1dc` — Expose owner-confirmed **Revoke selected Replica** on the normal Wall UI alongside Authorize Replica, so key changes no longer require hidden JSON/fingerprint/manual controls. CSRF, Wall owner identity and Home-only grant rules still apply. Source candidate deployed to UAT.

## Verified real-world observations, distinct from mock tests

- LXD UAT initial `387498d` had 2 runtime blockers: `device_channel_action_denied` via Plugin public gateway, and `gold_sync_private_key_invalid` because /var/lib/light-remote-gold-uat/wall/gold-wall-modules.sqlite.device-x25519-key was root:root 0600, while service runs as gold-uat. The **existing** key was chowned to gold-uat:gold-uat 0600; bytes/identity preserved; `runuser -u gold-uat node crypto.createPrivateKey` PASS. No new key generated.
- After `75061a0`, a separate one-shot test signed with the **real enrolled UAT Agent key** sent `memory-peers`, `memory-invites:list`, `memory-relay:pull_acks` through `https://gold.light-remote.thaiduy.digital/device-channel/<action>`. All returned valid expected envelopes, two owned devices, no checkpoint bodies. Test script held only under /tmp for UAT; no private keys output.
- Windows `DESKTOP-VA16D27` official Gold A/B device; client core had **already updated externally** from older source to exactly `387498d` staged candidate at inspection: 100/100 staged client core file hashes matched installed, despite version string still rc.49. Assistant did not install/overwrite/restart Windows. Candidate working folder `%LOCALAPPDATA%\\Light Remote\\G3-Account-UAT-387498d`; backup taken AFTER candidate was already installed, thus **NOT** a pre-update rollback image. Signed test on Windows with its own enrollment identity returned `WINDOWS_G3_REAL_ENROLLMENT_SIGNED_MEMORY_DIRECTORY_PASS`, with both devices Memory-ready. Windows flags: Long Memory ON, Codex Bridge ON; `lm_scopes` count 0 at check.
- On Gold UAT Home SQLite there is EXISTING synthetic Scope `7a115f4f-bbed-4565-8493-31fa92ebebb3`, `G3 NETBIRD DIRECT SYNTHETIC UAT`, Home device `dev_e68276c691ba5413f42d5dde`, revision 1, policy `selected_devices`, existing unrevoked grant to Windows device `dev_8d0715fce77efffce4c5ed28`. **The existing grant's public keys DO NOT MATCH today's Windows Memory keys** once both identities were confirmed live. Do NOT re-offer, force-accept or automatically rotate this stale grant. Need explicit owner revoke on Home and reauthorize current peer identity.
- A separate real relay functional test over two independent local SQLite databases passed two signed E2EE frames/ACKs and isolated Scope; this is PROTOCOL PASS, **not** live inter-device checkpoint replication acceptance.
- Last proven UAT source `6d5dd09`, four services active; Wall owner-gated HTTP and all candidate scoped/core regression tests PASS. GitHub CI for `f11033c` all four workflows succeeded; `6d5dd09` Wall parity succeeded and remaining workflows were running at first review; refresh GitHub CI before release.

## Owner actions REQUIRED before real cross-device replication gate

Use the official, authenticated Gold UAT Wall (not bypassing it via privileged shell):

1. Gold Home Wall `http://100.94.184.141:5591/`: open Long Memory; select existing `G3 NETBIRD DIRECT SYNTHETIC UAT` Scope; Refresh account devices; select `DESKTOP-VA16D27`.
2. Check explicit permission-change approval and click **Revoke selected Replica**; confirm. This revokes the obsolete signed grant, not any other Scope.
3. Still on the Home Wall, check approval again, **Authorize Replica**. The Home will sign a new grant against the currently account-verified Windows Memory public keys and offer via signed Device Channel.
4. On Windows's own Local Wall `http://127.0.0.1:5491/`, open Long Memory, click **Check sync invitations**, inspect the exact Scope/Home, then explicitly **Approve on this Replica**. Do not auto-accept or simulate owner acceptance in shell.
5. Only after that, observe automatic encrypted transport/ACK on both devices (run two SYNTHETIC checkpoint revisions only, check Home ACK revision 1 then 2, Replica `home_ed25519_verified`, offline/reconnect, no other Scope content). Direct P2P is not yet auto-orchestrated; the bounded RAM E2EE relay is the current automatic fallback. G3 remains NOT ACCEPTED until two-device live checkpoint sync PASS.

## Rollback and safety

- LXD snapshots: `gold-before-memory-account-relay-20261025`, `gold-before-g3-channel-fix-20261025`, `gold-before-g3-grant-reoffer-20261025`, `gold-before-g3-owner-key-reapproval-20261025`, plus older established Gold snapshots.
- The authoritative developer branch is the integrated Gold branch above. Old `feature/project-continuity-plan-20261023` is not suitable for product work.
- Do not output or copy enrollment private keys, Memory signing/encryption private keys, owner credentials, cookies or Memory checkpoint bodies. The live signed tests printed **only sanitized result states**.
- Operator's Memory rendezvous and relay are transient process memory (not persistent key directory). Restart clears advertisements/invitations and requires an enrolled agent to re-advertise; the safe same-grant re-offer handles expired invitations. A roster may briefly show "Memory not advertised" while awaiting the Windows 90-second refresh.
- No direct ChatGPT-Web session injection or autonomous task completion. The optional Codex Bridge and existing Gold UI/permissions must remain intact.

## Next exact task

Wait for the owner to complete authenticated Wall grant reapproval on both devices. Then use official Gold MCP on explicitly selected UAT and Windows devices for observational verification and two synthetic checkpoint revisions. If live E2E passes, only then mark G3 accepted; proceed to G4/G5/G6 parity. If UI fails, inspect `local-wall.mjs`, `gold-memory-sync.mjs`, `operator-host/gold-memory-rendezvous.mjs`, `operator-host/executor-routes-device-channel.mjs`, `plugin-server/device-public.mjs` and UAT service logs before adding new tests.
