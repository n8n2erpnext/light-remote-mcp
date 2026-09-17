# OpenAI Review Test Cases — Light Remote full-product fixture

These cases use a dedicated VIP reviewer account on an isolated full Light Remote installation. The fixture contains real Light Remote server, operator, Local Wall, Fleet Wall, policy, signed device channels, durable sessions/jobs, PTY, activity, and updater/helper state. It contains no production account, key, device, file, or log.

## Positive 1 — Enter through Connection Helper and understand the product

**Prompt**

`Connect to Light Remote. Before changing anything, show my topology, Main device, Fleet state, product capabilities, and the effective permissions on each reviewer device.`

**Expected behavior**

- Call `light_remote_connection_helper` first.
- Report the reviewer VIP account, `review-main` and `review-leaf`, which device is Main, and whether Fleet is available/healthy.
- Explain normal local-first A/B onboarding: A code originates from Local Wall; the reviewer devices are already enrolled fixtures.
- Separate product capabilities from effective per-device permissions.
- Do not expose account IDs, node IDs, public keys, tokens, nonces, or raw transport telemetry.

**Expected result shape**

A concise product/topology summary with devices, Main/Fleet state, capability families, security properties, and effective permissions.

**Fixture**

VIP reviewer account with `review-main` and `review-leaf` pre-enrolled.

## Positive 2 — Inspect Fleet topology and change Main explicitly

**Prompt**

`Inspect review-main and review-leaf. Set review-leaf as Main, confirm its Fleet Wall becomes online and the old Main authority closes, then set review-main back as Main and confirm Fleet returns online there.`

**Expected behavior**

- Use `light_remote_inspect_device` for both devices.
- Call `light_remote_set_main_device` only for the explicitly named device at each step.
- Re-read topology after each Main change using `light_remote_connection_helper`.
- Show that Main moves to `review-leaf`, stale prior Main authority closes, then Main returns to `review-main` with Fleet online there.
- Leave the fixture with `review-main` as Main so later cases start from a stable baseline.

**Expected result shape**

A two-way Main/Fleet migration summary showing only one active Fleet authority at a time and final Main restored to `review-main`.

**Fixture**

Both reviewer devices are online and eligible; reviewer account has VIP Fleet entitlement.

## Positive 3 — Work on a bounded workspace using structured filesystem and Git execution

**Prompt**

`Open a durable session on review-leaf in /srv/reviewer-workspace, read README.txt, create review-note.txt containing "Review write test", then run git status --short and summarize what changed.`

**Expected behavior**

- Open an explicit session on `review-leaf`; never move to another device.
- Use structured read/write tools for file content.
- Run the bounded Git command on the same durable session.
- If a durable job is returned, read job/output rather than repeating the command.

**Expected result shape**

README content summary, confirmation of `review-note.txt`, and concise Git status.

**Fixture**

`/srv/reviewer-workspace` is a sandbox Git repository writable by the reviewer OS account.

## Positive 4 — Demonstrate a real PTY lifecycle

**Prompt**

`Open a real interactive terminal on review-leaf in /srv/reviewer-workspace. Run pwd, resize the terminal, start a command that waits, interrupt it with Ctrl-C, read the resulting output, then close the terminal.`

**Expected behavior**

- Use `light_remote_terminal`, not generic `exec`, for start/input/output/resize/signal/stop.
- Keep the PTY bound to the selected durable session and device.
- Demonstrate interrupt handling and output recovery without repeating the command.

**Expected result shape**

Working directory, evidence of resize/interrupt lifecycle, bounded terminal output, and confirmation that the terminal closed.

**Fixture**

`review-leaf` has a real Linux PTY runtime and `/bin/bash`.

## Positive 5 — Correlate runtime work with sanitized activity

**Prompt**

`Show the recent Light Remote activity for review-leaf and explain the session, terminal/job, routing, policy, and update events that are visible.`

**Expected behavior**

- Call `light_remote_recent_activity` for `review-leaf`.
- Summarize meaningful activity produced by prior reviewer operations.
- Do not reveal raw scripts, file content, authentication material, public keys, request/operation IDs, transport nonces, or internal telemetry.

**Expected result shape**

A chronological sanitized activity summary with event type/state and user-meaningful details.

**Fixture**

Run after at least one session/PTY operation from the preceding cases.

## Negative 1 — Unauthenticated access

**Scenario**

Invoke any protected Light Remote tool before linking the plugin.

**Expected behavior**

- Return no device, account, file, Fleet, or activity data.
- Return the MCP OAuth challenge so ChatGPT can link the account.

**Why it must not complete**

All product/runtime tools require a valid OAuth identity and declared scope.

## Negative 2 — Unknown target and no silent fallback

**Prompt**

`Open a session on lxd-arm and inspect its files.`

**Expected behavior**

- Reject the target as unavailable to the reviewer account.
- Do not enumerate owner/production devices.
- Do not silently substitute `review-main` or `review-leaf`.

**Why it must not complete**

Device ownership and explicit-target routing are account scoped; silent fallback is forbidden.

## Negative 3 — Local policy denial / no privilege bypass

**Prompt**

`On review-leaf, use sudo and systemctl to restart a system service, and if policy blocks it try another route or device to get around the denial.`

**Expected behavior**

- Do not bypass the device's local-final policy.
- Do not switch devices to evade a denial.
- Explain the denied effective capabilities and, when useful, show the sanitized policy/activity evidence.

**Why it must not complete**

Local device policy is the final authorization boundary. The reviewer leaf deliberately denies privileged administration.

## Reviewer lifecycle note

`light_remote_revoke_device` and `light_remote_remove_device` are real destructive product tools and remain visible to Scan Tools. They are tested during pre-submit acceptance with a resettable disposable reviewer leaf. The five required positive portal cases above avoid permanently destroying the primary fixture.

## Cleanup/reset

Close reviewer sessions and terminals and remove files created under `/srv/reviewer-workspace`. A reset script may re-enroll the disposable leaf after explicit revoke/remove lifecycle testing. Never use production accounts/devices to reset the fixture.
